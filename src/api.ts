import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { BrowserManager } from './browser.js'
import { BrowserDiscovery } from './discovery.js'
import type { KeepAliveScheduler } from './maintenance.js'
import type {
  BrowserKind,
  DiscoveredBrowserDataDirectory,
  PublicBrowserDataDirectory,
  PublicBrowserProfile,
  PublicPlatformAccount,
} from './shared.js'
import type { AccountRepository } from './store.js'

const API_PATH = '/platform-account-manager/api/accounts'

export interface PublicState {
  accounts: PublicPlatformAccount[]
  archivedAccounts: PublicPlatformAccount[]
  directories: PublicBrowserDataDirectory[]
  archivedDirectories: PublicBrowserDataDirectory[]
  profiles: PublicBrowserProfile[]
  availableDirectories: DiscoveredBrowserDataDirectory[]
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function isLoopbackAddress(value: string | undefined): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1' || value === 'localhost'
}

function trustedRequest(req: IncomingMessage): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return isLoopbackAddress(new URL(origin).hostname)
  } catch {
    return false
  }
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = String(req.headers['content-type'] || '')
  if (!contentType.toLowerCase().startsWith('application/json')) throw new TypeError('content-type must be application/json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1024 * 1024) throw new TypeError('request body is too large')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TypeError('request body must be an object')
  return parsed as Record<string, unknown>
}

function accountId(value: unknown): string {
  if (typeof value !== 'string' || !/^ACC-\d{4,}$/.test(value)) throw new TypeError('valid account id is required')
  return value
}

function uuidId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new TypeError(`valid ${field} is required`)
  return value
}

export async function publicState(
  repository: AccountRepository,
  browser: BrowserManager,
  discovery = new BrowserDiscovery(),
): Promise<PublicState> {
  const [accounts, archivedAccounts, activeDirectoryRecords, archivedDirectoryRecords, profileRecords] = await Promise.all([
    repository.list(),
    repository.list({ archived: true }),
    repository.listDirectories(),
    repository.listDirectories({ archived: true }),
    repository.listProfiles(),
  ])
  const directoryRecords = [...activeDirectoryRecords, ...archivedDirectoryRecords]
  const statusEntries = await Promise.all(directoryRecords.map(async directory => [directory.id, await browser.directoryStatus(directory)] as const))
  const statuses = new Map(statusEntries)
  const decorateDirectory = (directory: typeof directoryRecords[number]): PublicBrowserDataDirectory => ({
    ...directory,
    accountCount: [...accounts, ...archivedAccounts].filter(account => account.browserDataDirectoryId === directory.id).length,
    activeAccountCount: accounts.filter(account => account.browserDataDirectoryId === directory.id).length,
    archivedAccountCount: archivedAccounts.filter(account => account.browserDataDirectoryId === directory.id).length,
    status: statuses.get(directory.id)!,
  })
  const directories = activeDirectoryRecords.map(decorateDirectory)
  const archivedDirectories = archivedDirectoryRecords.map(decorateDirectory)
  const directoryMap = new Map(directoryRecords.map(directory => [directory.id, directory]))
  const profileMap = new Map(profileRecords.map(profile => [profile.id, profile]))
  const availableDirectories = await discovery.discover(directoryRecords, profileRecords, [...accounts, ...archivedAccounts])
  const discoveredProfiles = new Set(availableDirectories.flatMap(directory => directory.profiles.map(profile => (
    `${directory.registeredDirectoryId || ''}\u0000${profile.directoryName.toLowerCase()}`
  ))))
  const publicProfiles: PublicBrowserProfile[] = profileRecords.map(profile => {
    const status = statuses.get(profile.browserDataDirectoryId)
    return {
      ...profile,
      accountCount: [...accounts, ...archivedAccounts].filter(account => account.browserProfileId === profile.id).length,
      activeAccountCount: accounts.filter(account => account.browserProfileId === profile.id).length,
      archivedAccountCount: archivedAccounts.filter(account => account.browserProfileId === profile.id).length,
      exists: profile.origin === 'plugin-created' || discoveredProfiles.has(`${profile.browserDataDirectoryId}\u0000${profile.directoryName.toLowerCase()}`),
      online: status?.onlineProfileIds.includes(profile.id) || false,
      cookieSync: browser.profileCookieStatus(profile.id),
    }
  })
  const decorate = async (account: typeof accounts[number]): Promise<PublicPlatformAccount> => {
    const directory = directoryMap.get(account.browserDataDirectoryId)
    if (!directory) throw new Error(`account ${account.id} has no browser data directory`)
    const profile = profileMap.get(account.browserProfileId)
    if (!profile) throw new Error(`account ${account.id} has no browser profile`)
    return {
      ...account,
      directory,
      profile,
      status: await browser.platformStatus(account, directory, profile),
    }
  }
  const [publicAccounts, publicArchivedAccounts] = await Promise.all([
    Promise.all(accounts.map(decorate)),
    Promise.all(archivedAccounts.map(decorate)),
  ])
  return {
    accounts: publicAccounts,
    archivedAccounts: publicArchivedAccounts,
    directories,
    archivedDirectories,
    profiles: publicProfiles,
    availableDirectories,
  }
}

function revealDirectory(path: string): void {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [path], { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
}

async function pickDirectory(picker: DirectoryPicker): Promise<string | null> {
  const capability = picker.capability()
  if (capability.kind !== 'native') throw new Error('this DSH host does not expose a native directory picker')
  return await capability.pick(new AbortController().signal)
}

export function createApiHandler(
  repository: AccountRepository,
  browser: BrowserManager,
  scheduler: KeepAliveScheduler,
  directoryPicker: DirectoryPicker,
  discovery = new BrowserDiscovery(),
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (!trustedRequest(req)) {
        json(res, 403, { ok: false, error: 'Platform data is available only from this computer.' })
        return
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname !== API_PATH) {
        json(res, 404, { ok: false, error: 'Not found' })
        return
      }
      if (req.method === 'GET') {
        json(res, 200, { ok: true, state: await publicState(repository, browser, discovery) })
        return
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST')
        json(res, 405, { ok: false, error: 'Method not allowed' })
        return
      }

      const request = await body(req)
      let result: unknown
      switch (request.action) {
        case 'create':
          result = await repository.create(request.account, request.directory)
          break
        case 'update':
          result = await repository.update(accountId(request.id), request.account)
          break
        case 'archive':
          result = await repository.archive(accountId(request.id))
          break
        case 'restore':
          result = await repository.restore(accountId(request.id))
          break
        case 'delete':
          result = await repository.remove(accountId(request.id))
          break
        case 'open': {
          const account = await repository.get(accountId(request.id))
          const directory = await repository.directoryForAccount(account)
          result = await browser.open(account, directory, await repository.profileForAccount(account))
          break
        }
        case 'close-browser': {
          const account = await repository.get(accountId(request.id))
          await browser.closeProfile(
            await repository.directoryForAccount(account),
            await repository.profileForAccount(account),
          )
          break
        }
        case 'check-login': {
          const account = await repository.get(accountId(request.id))
          const directory = await repository.directoryForAccount(account)
          const profile = await repository.profileForAccount(account)
          const wasProfileOnline = await browser.isOnline(directory, profile)
          try {
            const check = await browser.checkLogin(account, directory, profile, true)
            await repository.recordLoginCheck(account.id, check)
            result = check
          } finally {
            if (!wasProfileOnline) await browser.closeProfile(directory, profile).catch(() => undefined)
          }
          break
        }
        case 'manual-confirm-login': {
          const selectedAccountId = accountId(request.id)
          const account = await repository.get(selectedAccountId)
          await browser.persistSessionCookies(
            await repository.directoryForAccount(account),
            await repository.profileForAccount(account),
          )
          result = await repository.manualConfirmLogin(selectedAccountId)
          break
        }
        case 'keep-alive-settings':
          result = await repository.setKeepAlive(accountId(request.id), request.keepAlive)
          break
        case 'keep-alive-now':
          result = await scheduler.runNow(accountId(request.id))
          break
        case 'sync-cookies': {
          const profile = await repository.getProfile(uuidId(request.profileId, 'profile id'))
          const directory = await repository.getDirectory(profile.browserDataDirectoryId)
          result = { persisted: await browser.persistSessionCookies(directory, profile) }
          break
        }
        case 'pick-directory':
          result = { path: await pickDirectory(directoryPicker) }
          break
        case 'inspect-directory': {
          if (request.browser !== 'chrome' && request.browser !== 'edge') throw new TypeError('browser must be chrome or edge')
          if (typeof request.path !== 'string') throw new TypeError('directory path is required')
          const [directories, archivedDirectories, profiles, accounts, archivedAccounts] = await Promise.all([
            repository.listDirectories(),
            repository.listDirectories({ archived: true }),
            repository.listProfiles(),
            repository.list(),
            repository.list({ archived: true }),
          ])
          result = await discovery.inspectManual(
            request.browser as BrowserKind,
            request.path,
            [...directories, ...archivedDirectories],
            profiles,
            [...accounts, ...archivedAccounts],
          )
          break
        }
        case 'scan-computer': {
          const [directories, archivedDirectories, profiles, accounts, archivedAccounts] = await Promise.all([
            repository.listDirectories(),
            repository.listDirectories({ archived: true }),
            repository.listProfiles(),
            repository.list(),
            repository.list({ archived: true }),
          ])
          result = await discovery.scanComputer(
            [...directories, ...archivedDirectories],
            profiles,
            [...accounts, ...archivedAccounts],
          )
          break
        }
        case 'reveal-directory': {
          const directory = await repository.getDirectory(uuidId(request.directoryId, 'directory id'), true)
          revealDirectory(directory.path)
          break
        }
        case 'rename-directory':
          result = await repository.renameDirectory(uuidId(request.directoryId, 'directory id'), request.name)
          break
        case 'rename-profile':
          result = await repository.renameProfile(uuidId(request.profileId, 'profile id'), request.userIdentifier)
          break
        case 'archive-directory': {
          const directory = await repository.getDirectory(uuidId(request.directoryId, 'directory id'))
          result = await repository.archiveDirectory(directory.id, { online: await browser.isOnline(directory) })
          break
        }
        case 'restore-directory':
          result = await repository.restoreDirectory(uuidId(request.directoryId, 'directory id'))
          break
        case 'delete-directory': {
          const directory = await repository.getDirectory(uuidId(request.directoryId, 'directory id'), true)
          result = await repository.deleteDirectory(directory.id, {
            online: await browser.isOnline(directory),
            deleteLocalData: request.deleteLocalData === true,
            ...(typeof request.confirmationName === 'string' ? { confirmationName: request.confirmationName } : {}),
          })
          break
        }
        default:
          throw new TypeError('unknown action')
      }
      json(res, 200, { ok: true, result, state: await publicState(repository, browser, discovery) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(res, error instanceof TypeError ? 400 : 500, { ok: false, error: message })
    }
  }
}

export const apiRoute = {
  kind: 'exact' as const,
  path: API_PATH,
}

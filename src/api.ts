import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { BrowserManager } from './browser.js'
import type { KeepAliveScheduler } from './maintenance.js'
import type { PublicBrowserDataDirectory, PublicPlatformAccount } from './shared.js'
import type { AccountRepository } from './store.js'

const API_PATH = '/store-account-manager/api/accounts'

export interface PublicState {
  accounts: PublicPlatformAccount[]
  archivedAccounts: PublicPlatformAccount[]
  directories: PublicBrowserDataDirectory[]
  archivedDirectories: PublicBrowserDataDirectory[]
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

function id(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new TypeError(`valid ${field} is required`)
  return value
}

export async function publicState(repository: AccountRepository, browser: BrowserManager): Promise<PublicState> {
  const [accounts, archivedAccounts, activeDirectoryRecords, archivedDirectoryRecords] = await Promise.all([
    repository.list(),
    repository.list({ archived: true }),
    repository.listDirectories(),
    repository.listDirectories({ archived: true }),
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
  const decorate = async (account: typeof accounts[number]): Promise<PublicPlatformAccount> => {
    const directory = directoryMap.get(account.browserDataDirectoryId)
    if (!directory) throw new Error(`account ${account.id} has no browser data directory`)
    return {
      ...account,
      directory,
      status: await browser.platformStatus(account, directory),
    }
  }
  const [publicAccounts, publicArchivedAccounts] = await Promise.all([
    Promise.all(accounts.map(decorate)),
    Promise.all(archivedAccounts.map(decorate)),
  ])
  return { accounts: publicAccounts, archivedAccounts: publicArchivedAccounts, directories, archivedDirectories }
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
        json(res, 200, { ok: true, state: await publicState(repository, browser) })
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
          result = await repository.update(id(request.id), request.account)
          break
        case 'archive':
          result = await repository.archive(id(request.id))
          break
        case 'restore':
          result = await repository.restore(id(request.id))
          break
        case 'delete':
          result = await repository.remove(id(request.id))
          break
        case 'open': {
          const account = await repository.get(id(request.id))
          const directory = await repository.directoryForAccount(account)
          result = await browser.open(account, directory)
          break
        }
        case 'close-browser': {
          const account = await repository.get(id(request.id))
          await browser.close(await repository.directoryForAccount(account))
          break
        }
        case 'check-login': {
          const account = await repository.get(id(request.id))
          const directory = await repository.directoryForAccount(account)
          const wasOnline = await browser.isOnline(directory)
          try {
            const check = await browser.checkLogin(account, directory, true)
            await repository.recordLoginCheck(account.id, check)
            result = check
          } finally {
            if (!wasOnline) await browser.close(directory).catch(() => undefined)
          }
          break
        }
        case 'manual-confirm-login': {
          const accountId = id(request.id)
          const account = await repository.get(accountId)
          await browser.persistSessionCookies(await repository.directoryForAccount(account))
          result = await repository.manualConfirmLogin(accountId)
          break
        }
        case 'keep-alive-settings':
          result = await repository.setKeepAlive(id(request.id), request.keepAlive)
          break
        case 'keep-alive-now':
          result = await scheduler.runNow(id(request.id))
          break
        case 'sync-cookies': {
          const directory = await repository.getDirectory(id(request.directoryId, 'directory id'))
          result = { persisted: await browser.persistSessionCookies(directory) }
          break
        }
        case 'pick-directory':
          result = { path: await pickDirectory(directoryPicker) }
          break
        case 'reveal-directory': {
          const directory = await repository.getDirectory(id(request.directoryId, 'directory id'), true)
          revealDirectory(directory.path)
          break
        }
        case 'rename-directory':
          result = await repository.renameDirectory(id(request.directoryId, 'directory id'), request.name)
          break
        case 'archive-directory': {
          const directory = await repository.getDirectory(id(request.directoryId, 'directory id'))
          result = await repository.archiveDirectory(directory.id, { online: await browser.isOnline(directory) })
          break
        }
        case 'restore-directory':
          result = await repository.restoreDirectory(id(request.directoryId, 'directory id'))
          break
        case 'delete-directory': {
          const directory = await repository.getDirectory(id(request.directoryId, 'directory id'), true)
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
      json(res, 200, { ok: true, result, state: await publicState(repository, browser) })
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

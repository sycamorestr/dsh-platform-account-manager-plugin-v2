import { access, readFile, readdir } from 'node:fs/promises'
import { basename, join, normalize, resolve } from 'node:path'
import type {
  BrowserDataDirectory,
  BrowserDirectoryDiscoverySource,
  BrowserKind,
  BrowserProfile,
  DiscoveredBrowserDataDirectory,
  DiscoveredBrowserProfile,
  PlatformAccount,
} from './shared.js'

interface DiscoveryCandidate {
  browser: BrowserKind
  path: string
  name: string
  source: BrowserDirectoryDiscoverySource
  registeredDirectoryId?: string
}

const MAX_SCAN_DIRECTORIES = 30_000
const MAX_SCAN_DEPTH = 8
const SCAN_CONCURRENCY = 32
const SCAN_EXCLUDED_DIRECTORIES = new Set([
  '$recycle.bin',
  'system volume information',
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'node_modules',
  '.git',
  '.pnpm-store',
])

interface LocalStateProfileInfo {
  name?: unknown
  user_name?: unknown
  is_using_default_name?: unknown
}

function normalizedPathKey(value: string): string {
  const path = normalize(resolve(value)).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function candidateKey(browser: BrowserKind, path: string): string {
  return `${browser}:${normalizedPathKey(path)}`
}

function inferredBrowser(path: string): BrowserKind {
  const normalized = path.toLowerCase()
  if (normalized.includes('\\microsoft\\edge') || normalized.includes('/microsoft/edge')) return 'edge'
  return 'chrome'
}

async function computerRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return ['/']
  const roots = Array.from({ length: 26 }, (_value, index) => `${String.fromCharCode(65 + index)}:\\`)
  const available = await Promise.all(roots.map(async root => await exists(root) ? root : undefined))
  return available.filter((root): root is string => Boolean(root))
}

function profileKey(directoryName: string): string {
  return process.platform === 'win32' ? directoryName.toLowerCase() : directoryName
}

function usableProfileDirectory(directoryName: string): boolean {
  const normalized = directoryName.trim().toLowerCase()
  if (!normalized || normalized === 'guest profile' || normalized === 'system profile') return false
  if (normalized.includes('backup') || normalized.startsWith('temp')) return false
  return directoryName === 'Default' || /^Profile \d+$/.test(directoryName)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function parseJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function profileDisplayName(value: LocalStateProfileInfo | undefined, directoryName: string): string {
  return typeof value?.name === 'string' && value.name.trim() ? value.name.trim() : directoryName
}

export async function inspectBrowserDataDirectory(
  browser: BrowserKind,
  pathValue: string,
  registeredProfiles: BrowserProfile[] = [],
  accounts: PlatformAccount[] = [],
): Promise<DiscoveredBrowserProfile[]> {
  const path = resolve(pathValue)
  const profiles = new Map<string, DiscoveredBrowserProfile>()
  const localState = await parseJson(join(path, 'Local State'))
  const profileState = localState?.profile
  const infoCache = typeof profileState === 'object' && profileState !== null && !Array.isArray(profileState)
    ? (profileState as Record<string, unknown>).info_cache
    : undefined
  if (typeof infoCache === 'object' && infoCache !== null && !Array.isArray(infoCache)) {
    for (const [directoryName, rawInfo] of Object.entries(infoCache as Record<string, unknown>)) {
      if (!usableProfileDirectory(directoryName)) continue
      if (!await exists(join(path, directoryName, 'Preferences'))) continue
      const info = typeof rawInfo === 'object' && rawInfo !== null && !Array.isArray(rawInfo)
        ? rawInfo as LocalStateProfileInfo
        : undefined
      const name = profileDisplayName(info, directoryName)
      profiles.set(profileKey(directoryName), {
        directoryName,
        name,
        userIdentifier: name,
        accountCount: 0,
      })
    }
  }
  try {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!entry.isDirectory() || !usableProfileDirectory(entry.name)) continue
      if (!await exists(join(path, entry.name, 'Preferences'))) continue
      const key = profileKey(entry.name)
      if (profiles.has(key)) continue
      const preferences = await parseJson(join(path, entry.name, 'Preferences'))
      const rawProfile = preferences?.profile
      const name = typeof rawProfile === 'object' && rawProfile !== null && !Array.isArray(rawProfile)
        && typeof (rawProfile as Record<string, unknown>).name === 'string'
        ? String((rawProfile as Record<string, unknown>).name).trim()
        : ''
      profiles.set(key, {
        directoryName: entry.name,
        name: name || entry.name,
        userIdentifier: name || entry.name,
        accountCount: 0,
      })
    }
  } catch {
    // A missing or unreadable optional root produces only its stored profiles.
  }
  for (const profile of registeredProfiles) {
    const key = profileKey(profile.directoryName)
    const accountCount = accounts.filter(account => account.browserProfileId === profile.id).length
    const current = profiles.get(key)
    profiles.set(key, {
      directoryName: profile.directoryName,
      name: current?.name || profile.name,
      userIdentifier: profile.userIdentifier,
      registeredProfileId: profile.id,
      accountCount,
    })
  }
  return [...profiles.values()].sort((left, right) => {
    if (left.directoryName === 'Default') return -1
    if (right.directoryName === 'Default') return 1
    return left.directoryName.localeCompare(right.directoryName, undefined, { numeric: true })
  })
}

function standardCandidates(): DiscoveryCandidate[] {
  const local = process.env.LOCALAPPDATA
  if (!local) return []
  return [
    ['chrome', join(local, 'Google', 'Chrome', 'User Data'), 'Google Chrome'],
    ['chrome', join(local, 'Google', 'Chrome Beta', 'User Data'), 'Google Chrome Beta'],
    ['chrome', join(local, 'Google', 'Chrome Dev', 'User Data'), 'Google Chrome Dev'],
    ['chrome', join(local, 'Google', 'Chrome SxS', 'User Data'), 'Google Chrome Canary'],
    ['edge', join(local, 'Microsoft', 'Edge', 'User Data'), 'Microsoft Edge'],
    ['edge', join(local, 'Microsoft', 'Edge Beta', 'User Data'), 'Microsoft Edge Beta'],
    ['edge', join(local, 'Microsoft', 'Edge Dev', 'User Data'), 'Microsoft Edge Dev'],
    ['edge', join(local, 'Microsoft', 'Edge SxS', 'User Data'), 'Microsoft Edge Canary'],
  ].map(([browser, path, name]) => ({ browser: browser as BrowserKind, path, name, source: 'standard' }))
}

export class BrowserDiscovery {
  private scannedCandidates: DiscoveryCandidate[] = []

  constructor(private scanOptions: {
    roots?: () => Promise<string[]>
    maxDirectories?: number
    maxDepth?: number
    concurrency?: number
  } = {}) {}

  async discover(
    directories: BrowserDataDirectory[],
    profiles: BrowserProfile[],
    accounts: PlatformAccount[],
  ): Promise<DiscoveredBrowserDataDirectory[]> {
    const candidates = new Map<string, DiscoveryCandidate>()
    for (const candidate of standardCandidates()) {
      if (await exists(candidate.path)) candidates.set(candidateKey(candidate.browser, candidate.path), candidate)
    }
    for (const candidate of this.scannedCandidates) {
      candidates.set(candidateKey(candidate.browser, candidate.path), candidate)
    }
    for (const directory of directories) {
      candidates.set(candidateKey(directory.browser, directory.path), {
        browser: directory.browser,
        path: directory.path,
        name: directory.name,
        source: 'registered',
        registeredDirectoryId: directory.id,
      })
    }
    const discovered: DiscoveredBrowserDataDirectory[] = []
    for (const candidate of candidates.values()) {
      const storedProfiles = candidate.registeredDirectoryId
        ? profiles.filter(profile => profile.browserDataDirectoryId === candidate.registeredDirectoryId)
        : []
      const foundProfiles = await inspectBrowserDataDirectory(candidate.browser, candidate.path, storedProfiles, accounts)
      if (!foundProfiles.length) continue
      discovered.push({
        key: candidateKey(candidate.browser, candidate.path),
        name: candidate.name,
        browser: candidate.browser,
        path: resolve(candidate.path),
        source: candidate.source,
        ...(candidate.registeredDirectoryId ? { registeredDirectoryId: candidate.registeredDirectoryId } : {}),
        profiles: foundProfiles,
      })
    }
    return discovered.sort((left, right) => left.browser.localeCompare(right.browser) || left.name.localeCompare(right.name))
  }

  async inspectManual(
    browser: BrowserKind,
    path: string,
    directories: BrowserDataDirectory[],
    profiles: BrowserProfile[],
    accounts: PlatformAccount[],
  ): Promise<DiscoveredBrowserDataDirectory> {
    const resolved = resolve(path)
    const registered = directories.find(directory => directory.browser === browser
      && normalizedPathKey(directory.path) === normalizedPathKey(resolved))
    const foundProfiles = await inspectBrowserDataDirectory(
      browser,
      resolved,
      registered ? profiles.filter(profile => profile.browserDataDirectoryId === registered.id) : [],
      accounts,
    )
    if (!foundProfiles.length) throw new TypeError('the selected folder is not a usable Chrome or Edge user data directory')
    return {
      key: candidateKey(browser, resolved),
      name: registered?.name || basename(resolved),
      browser,
      path: resolved,
      source: registered ? 'registered' : 'manual',
      ...(registered ? { registeredDirectoryId: registered.id } : {}),
      profiles: foundProfiles,
    }
  }

  async scanComputer(
    directories: BrowserDataDirectory[],
    profiles: BrowserProfile[],
    accounts: PlatformAccount[],
  ): Promise<DiscoveredBrowserDataDirectory[]> {
    const queue = (await (this.scanOptions.roots || computerRoots)()).map(path => ({ path, depth: 0 }))
    const found = new Map<string, DiscoveryCandidate>()
    const maxDirectories = this.scanOptions.maxDirectories || MAX_SCAN_DIRECTORIES
    const maxDepth = this.scanOptions.maxDepth ?? MAX_SCAN_DEPTH
    const concurrency = this.scanOptions.concurrency || SCAN_CONCURRENCY
    let visited = 0
    while (queue.length && visited < maxDirectories) {
      const batch = queue.splice(0, Math.min(concurrency, maxDirectories - visited))
      const results = await Promise.all(batch.map(async candidate => {
        visited += 1
        if (await exists(join(candidate.path, 'Local State'))) {
          const browser = inferredBrowser(candidate.path)
          const discoveredProfiles = await inspectBrowserDataDirectory(browser, candidate.path)
          if (discoveredProfiles.length) return { found: {
            browser,
            path: candidate.path,
            name: basename(candidate.path),
            source: 'scan' as const,
          } }
        }
        if (candidate.depth >= maxDepth) return {}
        try {
          const children = (await readdir(candidate.path, { withFileTypes: true }))
            .filter(entry => entry.isDirectory() && !entry.isSymbolicLink()
              && !SCAN_EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()))
            .map(entry => ({ path: join(candidate.path, entry.name), depth: candidate.depth + 1 }))
          return { children }
        } catch {
          return {}
        }
      }))
      for (const result of results) {
        if (result.found) found.set(candidateKey(result.found.browser, result.found.path), result.found)
        if (result.children) queue.push(...result.children)
      }
    }
    this.scannedCandidates = [...found.values()]
    return await this.discover(directories, profiles, accounts)
  }
}

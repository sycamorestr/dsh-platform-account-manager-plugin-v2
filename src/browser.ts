import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import type {
  BrowserDataDirectory,
  BrowserDirectoryStatus,
  BrowserKind,
  CookieSyncStatus,
  LoginCheckResult,
  PlatformAccount,
  PlatformStatus,
} from './shared.js'
import type { AccountRepository } from './store.js'

interface BrowserPaths {
  chrome?: string
  edge?: string
}

interface BrowserManagerOptions {
  browserPaths?: BrowserPaths
  cookieRetentionDays?: number
}

interface DevToolsVersion {
  webSocketDebuggerUrl: string
}

interface DevToolsProcessInfo {
  id: number
  type: string
}

interface DevToolsTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl?: string
}

interface BrowserRuntime {
  directoryId: string
  instanceId: string
  browser: BrowserKind
  path: string
  pid: number
  port: number
  startedAt: string
}

interface RuntimeDocument {
  version: 1
  runtimes: BrowserRuntime[]
}

export interface TrustedBrowserConnection {
  accountId: string
  directoryId: string
  instanceId: string
  browser: BrowserKind
  endpoint: string
}

export interface DevToolsCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  session: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  priority?: 'Low' | 'Medium' | 'High'
  sourceScheme?: 'Unset' | 'NonSecure' | 'Secure'
  sourcePort?: number
  partitionKey?: Record<string, unknown>
  partitionKeyOpaque?: boolean
}

export interface PersistentCookieParam {
  name: string
  value: string
  url?: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expires: number
  sameSite?: DevToolsCookie['sameSite']
  priority?: DevToolsCookie['priority']
  sourceScheme?: DevToolsCookie['sourceScheme']
  sourcePort?: number
  partitionKey?: Record<string, unknown>
}

const FAST_COOKIE_SYNC_INTERVAL_MS = 2000
const STEADY_COOKIE_SYNC_INTERVAL_MS = 15000
const FAST_COOKIE_SYNC_WINDOW_MS = 60000

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(2500) })
  if (!response.ok) throw new Error(`DevTools request failed: ${response.status} ${response.statusText}`)
  return await response.json() as T
}

function runtimeRecord(value: unknown): BrowserRuntime | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = value as Partial<BrowserRuntime>
  if (
    typeof raw.directoryId !== 'string' ||
    typeof raw.instanceId !== 'string' ||
    (raw.browser !== 'chrome' && raw.browser !== 'edge') ||
    typeof raw.path !== 'string' ||
    !Number.isInteger(raw.pid) || Number(raw.pid) <= 0 ||
    !Number.isInteger(raw.port) || Number(raw.port) <= 0 || Number(raw.port) > 65535 ||
    typeof raw.startedAt !== 'string' || !Number.isFinite(Date.parse(raw.startedAt))
  ) return undefined
  return raw as BrowserRuntime
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function allocateLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('could not allocate a browser debugging port'))
        return
      }
      const port = address.port
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

export function buildLaunchArguments(
  directory: BrowserDataDirectory,
  port: number,
  url: string,
  minimized = false,
): string[] {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new TypeError('remote debugging port must be a fixed nonzero port')
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${directory.path}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    ...(minimized ? ['--start-minimized'] : []),
    '--new-window',
    url,
  ]
}

export function persistentCookieParam(cookie: DevToolsCookie, expires: number): PersistentCookieParam {
  const host = cookie.domain.replace(/^\./, '')
  const scheme = cookie.secure || cookie.sourceScheme === 'Secure' ? 'https' : 'http'
  const hostOnly = !cookie.domain.startsWith('.') || cookie.name.startsWith('__Host-')
  return {
    name: cookie.name,
    value: cookie.value,
    ...(hostOnly ? { url: `${scheme}://${host}${cookie.path || '/'}` } : { domain: cookie.domain }),
    path: cookie.path || '/',
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    expires,
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    ...(cookie.priority ? { priority: cookie.priority } : {}),
    ...(cookie.sourceScheme ? { sourceScheme: cookie.sourceScheme } : {}),
    ...(cookie.sourcePort !== undefined ? { sourcePort: cookie.sourcePort } : {}),
    ...(cookie.partitionKey && !cookie.partitionKeyOpaque ? { partitionKey: cookie.partitionKey } : {}),
  }
}

class CdpSession {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()

  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(String(event.data)) as { id?: number, result?: unknown, error?: { message?: string } }
        if (!message.id) return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'))
        else pending.resolve(message.result)
      } catch {
        // Protocol events and malformed messages do not belong to pending requests.
      }
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed'))
      this.pending.clear()
    })
  }

  static async connect(url: string): Promise<CdpSession> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out connecting to browser')), 5000)
      socket.addEventListener('open', () => {
        clearTimeout(timeout)
        resolve()
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('could not connect to browser DevTools'))
      }, { once: true })
    })
    return new CdpSession(socket)
  }

  async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
    })
    this.socket.send(JSON.stringify({ id, method, params }))
    return await Promise.race([
      result,
      delay(10000).then(() => {
        this.pending.delete(id)
        throw new Error(`CDP command timed out: ${method}`)
      }),
    ])
  }

  close(): void {
    this.socket.close()
  }
}

export class BrowserManager {
  private runtimes = new Map<string, BrowserRuntime>()
  private cookieSync = new Map<string, CookieSyncStatus>()
  private persistenceLoops = new Map<string, AbortController>()
  private directoryLocks = new Map<string, Promise<void>>()
  private runtimeWriteQueue: Promise<void> = Promise.resolve()
  private browserPaths: BrowserPaths
  private cookieRetentionSeconds: number

  constructor(private repository: AccountRepository, options: BrowserManagerOptions = {}) {
    this.browserPaths = options.browserPaths || {}
    const retentionDays = Math.max(1, Math.min(3650, options.cookieRetentionDays || 365))
    this.cookieRetentionSeconds = retentionDays * 24 * 60 * 60
  }

  async init(): Promise<void> {
    let document: RuntimeDocument = { version: 1, runtimes: [] }
    try {
      const parsed = JSON.parse(await readFile(this.repository.runtimeFilename, 'utf8')) as Partial<RuntimeDocument>
      if (parsed.version === 1 && Array.isArray(parsed.runtimes)) {
        document = { version: 1, runtimes: parsed.runtimes.map(runtimeRecord).filter((value): value is BrowserRuntime => Boolean(value)) }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    const directories = new Map((await this.repository.listDirectories()).map(directory => [directory.id, directory]))
    for (const runtime of document.runtimes) {
      const directory = directories.get(runtime.directoryId)
      if (!directory || directory.browser !== runtime.browser || directory.path !== runtime.path) continue
      if (await this.runtimeIsHealthy(runtime)) {
        this.runtimes.set(directory.id, runtime)
        this.startCookiePersistence(directory)
      }
    }
    await this.persistRuntimes()
  }

  dispose(): void {
    for (const controller of this.persistenceLoops.values()) controller.abort()
    this.persistenceLoops.clear()
  }

  async directoryStatus(directory: BrowserDataDirectory): Promise<BrowserDirectoryStatus> {
    const runtime = await this.activeRuntime(directory)
    if (!runtime) return { online: false, pages: 0, cookieSync: this.cookieStatus(directory.id) }
    try {
      const pages = await this.targets(runtime.port)
      return {
        online: true,
        pages: pages.length,
        pid: runtime.pid,
        startedAt: runtime.startedAt,
        cookieSync: this.cookieStatus(directory.id),
      }
    } catch {
      await this.removeRuntime(directory.id, runtime.instanceId)
      return { online: false, pages: 0, cookieSync: this.cookieStatus(directory.id) }
    }
  }

  async platformStatus(account: PlatformAccount, directory: BrowserDataDirectory): Promise<PlatformStatus> {
    const runtime = await this.activeRuntime(directory)
    if (!runtime) return { browserOnline: false, platformOpen: false, pages: 0 }
    try {
      const pages = (await this.targets(runtime.port)).filter(target => this.belongsToAccount(target.url, account))
      return {
        browserOnline: true,
        platformOpen: pages.length > 0,
        pages: pages.length,
        ...(pages[0]?.url ? { currentUrl: this.redactUrl(pages[0].url) } : {}),
      }
    } catch {
      await this.removeRuntime(directory.id, runtime.instanceId)
      return { browserOnline: false, platformOpen: false, pages: 0 }
    }
  }

  async open(account: PlatformAccount, directory: BrowserDataDirectory, requestedUrl?: string): Promise<PlatformStatus> {
    return await this.withDirectoryLock(directory.id, async () => {
      const url = this.accountUrl(account, requestedUrl)
      let runtime = await this.activeRuntime(directory)
      if (!runtime) {
        runtime = await this.launch(directory, url, false)
      } else {
        const existing = (await this.targets(runtime.port)).find(target => this.sameDocument(target.url, url))
        if (existing?.webSocketDebuggerUrl) await this.bringToFront(existing).catch(() => undefined)
        else await this.createTarget(runtime.port, url)
      }
      await this.repository.markOpened(account.id)
      this.startCookiePersistence(directory)
      return await this.platformStatus(account, directory)
    })
  }

  async close(directory: BrowserDataDirectory): Promise<void> {
    await this.withDirectoryLock(directory.id, async () => {
      const runtime = await this.activeRuntime(directory)
      this.stopCookiePersistence(directory.id)
      if (!runtime) return
      await this.persistSessionCookies(directory).catch(() => undefined)
      try {
        const version = await this.version(runtime.port)
        const session = await CdpSession.connect(version.webSocketDebuggerUrl)
        try {
          await session.send('Browser.close')
        } finally {
          session.close()
        }
      } catch {
        if (await this.runtimeIsHealthy(runtime)) throw new Error('browser did not accept the close command')
      }
      for (let attempt = 0; attempt < 30 && await this.runtimeIsHealthy(runtime); attempt += 1) await delay(100)
      await this.removeRuntime(directory.id, runtime.instanceId)
    })
  }

  async persistSessionCookies(directory: BrowserDataDirectory): Promise<number> {
    const runtime = await this.activeRuntime(directory)
    if (!runtime) return 0
    try {
      const session = await CdpSession.connect((await this.version(runtime.port)).webSocketDebuggerUrl)
      try {
        const result = await session.send<{ cookies: DevToolsCookie[] }>('Storage.getCookies')
        const cookies = result.cookies.filter(cookie => cookie.session && !cookie.partitionKeyOpaque)
        const expires = Math.floor(Date.now() / 1000) + this.cookieRetentionSeconds
        let persisted = 0
        for (const cookie of cookies) {
          try {
            await session.send('Storage.setCookies', { cookies: [persistentCookieParam(cookie, expires)] })
            persisted += 1
          } catch {
            // Unsupported attributes on one cookie must not block the rest of the login state.
          }
        }
        if (cookies.length && !persisted) throw new Error('Chromium rejected all session cookies')
        this.cookieSync.set(directory.id, {
          state: 'ok',
          lastSyncedAt: new Date().toISOString(),
          persistedCount: persisted,
        })
        return persisted
      } finally {
        session.close()
      }
    } catch (error) {
      this.cookieSync.set(directory.id, {
        state: 'error',
        lastSyncedAt: new Date().toISOString(),
        persistedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async checkLogin(account: PlatformAccount, directory: BrowserDataDirectory, minimized = false): Promise<LoginCheckResult> {
    const checkedAt = new Date().toISOString()
    const probeUrl = account.shopUrl || account.loginUrl
    if (!probeUrl) return { state: 'unknown', message: 'No platform or login URL is configured.', checkedAt }
    return await this.withDirectoryLock(directory.id, async () => {
      let target: DevToolsTarget | undefined
      let temporaryTarget = false
      try {
        let runtime = await this.activeRuntime(directory)
        if (!runtime) {
          runtime = await this.launch(directory, probeUrl, minimized)
          target = await this.waitForLaunchedTarget(runtime.port, account, probeUrl)
        } else {
          target = await this.createTarget(runtime.port, probeUrl)
          temporaryTarget = true
        }
        const settled = await this.waitForTarget(runtime.port, target.id)
        await this.persistSessionCookies(directory)
        return this.classifyLogin(account, settled.url, checkedAt)
      } catch (error) {
        return {
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
          checkedAt,
        }
      } finally {
        if (target && temporaryTarget) {
          const runtime = await this.activeRuntime(directory)
          if (runtime) await this.closeTarget(runtime.port, target.id).catch(() => undefined)
        }
      }
    })
  }

  async trustedConnection(account: PlatformAccount, directory: BrowserDataDirectory): Promise<TrustedBrowserConnection> {
    const runtime = await this.activeRuntime(directory)
    if (!runtime) throw new Error('browser data directory is offline')
    return {
      accountId: account.id,
      directoryId: directory.id,
      instanceId: runtime.instanceId,
      browser: runtime.browser,
      endpoint: `http://127.0.0.1:${runtime.port}`,
    }
  }

  async isOnline(directory: BrowserDataDirectory): Promise<boolean> {
    return Boolean(await this.activeRuntime(directory))
  }

  private cookieStatus(directoryId: string): CookieSyncStatus {
    return { ...(this.cookieSync.get(directoryId) || { state: 'idle', persistedCount: 0 }) }
  }

  private async launch(directory: BrowserDataDirectory, url: string, minimized: boolean): Promise<BrowserRuntime> {
    await mkdir(directory.path, { recursive: true, mode: 0o700 })
    const executable = await this.resolveExecutable(directory.browser)
    const port = await allocateLoopbackPort()
    const child = spawn(executable, buildLaunchArguments(directory, port, this.safeUrl(url, true), minimized), {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    const spawnError = new Promise<never>((_resolve, reject) => child.once('error', reject))
    const ready = this.waitForEndpoint(port)
    try {
      await Promise.race([ready, spawnError])
    } catch (error) {
      child.kill()
      throw error
    }
    if (!child.pid) throw new Error('browser started without a process id')
    const browserPid = await this.browserProcessId(port, child.pid)
    const runtime: BrowserRuntime = {
      directoryId: directory.id,
      instanceId: randomUUID(),
      browser: directory.browser,
      path: directory.path,
      pid: browserPid,
      port,
      startedAt: new Date().toISOString(),
    }
    this.runtimes.set(directory.id, runtime)
    await this.persistRuntimes()
    if (child.pid === browserPid) {
      child.once('exit', () => {
        void this.removeRuntime(directory.id, runtime.instanceId)
      })
    }
    child.unref()
    this.startCookiePersistence(directory)
    return runtime
  }

  private async activeRuntime(directory: BrowserDataDirectory): Promise<BrowserRuntime | undefined> {
    const runtime = this.runtimes.get(directory.id)
    if (!runtime) return undefined
    if (runtime.browser !== directory.browser || runtime.path !== directory.path || !await this.runtimeIsHealthy(runtime)) {
      await this.removeRuntime(directory.id, runtime.instanceId)
      return undefined
    }
    return runtime
  }

  private async runtimeIsHealthy(runtime: BrowserRuntime): Promise<boolean> {
    try {
      await this.version(runtime.port)
      if (processExists(runtime.pid)) return true
      const browserPid = await this.browserProcessId(runtime.port, 0)
      if (!browserPid || !processExists(browserPid)) return false
      runtime.pid = browserPid
      return true
    } catch {
      return false
    }
  }

  private async removeRuntime(directoryId: string, instanceId: string): Promise<void> {
    if (this.runtimes.get(directoryId)?.instanceId !== instanceId) return
    this.runtimes.delete(directoryId)
    this.stopCookiePersistence(directoryId)
    await this.persistRuntimes()
  }

  private async persistRuntimes(): Promise<void> {
    this.runtimeWriteQueue = this.runtimeWriteQueue.catch(() => undefined).then(async () => {
      const document: RuntimeDocument = { version: 1, runtimes: [...this.runtimes.values()] }
      await mkdir(dirname(this.repository.runtimeFilename), { recursive: true, mode: 0o700 })
      const temporary = `${this.repository.runtimeFilename}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.repository.runtimeFilename)
    })
    await this.runtimeWriteQueue
  }

  private startCookiePersistence(directory: BrowserDataDirectory): void {
    if (this.persistenceLoops.has(directory.id)) return
    const controller = new AbortController()
    const startedAt = Date.now()
    this.persistenceLoops.set(directory.id, controller)
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const runtime = await this.activeRuntime(directory)
          if (!runtime) break
          await this.persistSessionCookies(directory)
        } catch {
          if (!await this.activeRuntime(directory)) break
        }
        const interval = Date.now() - startedAt < FAST_COOKIE_SYNC_WINDOW_MS
          ? FAST_COOKIE_SYNC_INTERVAL_MS
          : STEADY_COOKIE_SYNC_INTERVAL_MS
        await delay(interval)
      }
    })().finally(() => {
      if (this.persistenceLoops.get(directory.id) === controller) this.persistenceLoops.delete(directory.id)
    })
  }

  private stopCookiePersistence(directoryId: string): void {
    const controller = this.persistenceLoops.get(directoryId)
    controller?.abort()
    if (this.persistenceLoops.get(directoryId) === controller) this.persistenceLoops.delete(directoryId)
  }

  private async withDirectoryLock<T>(directoryId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.directoryLocks.get(directoryId) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const chained = previous.then(() => current)
    this.directoryLocks.set(directoryId, chained)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.directoryLocks.get(directoryId) === chained) this.directoryLocks.delete(directoryId)
    }
  }

  private async waitForEndpoint(port: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await this.version(port)
        return
      } catch {
        await delay(100)
      }
    }
    throw new Error('browser did not expose its fixed debugging port within 20 seconds; close any browser already using this data directory and try again')
  }

  private async waitForLaunchedTarget(
    port: number,
    account: PlatformAccount,
    requestedUrl: string,
  ): Promise<DevToolsTarget> {
    let fallback: DevToolsTarget | undefined
    let fallbackSignature = ''
    let stableCount = 0
    for (let attempt = 0; attempt < 75; attempt += 1) {
      const pages = await this.targets(port)
      const preferred = pages.find(target => this.sameDocument(target.url, requestedUrl))
        || pages.find(target => this.belongsToAccount(target.url, account))
      if (preferred) return preferred

      const webPages = pages.filter(target => Boolean(this.parseWebUrl(target.url)))
      if (webPages.length === 1) {
        fallback = webPages[0]
        const signature = `${fallback.id}:${fallback.url}`
        if (signature === fallbackSignature) stableCount += 1
        else stableCount = 0
        fallbackSignature = signature
        if (stableCount >= 5) return fallback
      } else {
        fallback = undefined
        fallbackSignature = ''
        stableCount = 0
      }
      await delay(200)
    }
    if (fallback) return fallback
    throw new Error('browser started but did not expose the platform tab for login checking')
  }

  private async waitForTarget(port: number, targetId: string): Promise<DevToolsTarget> {
    let previousUrl = ''
    let stableCount = 0
    let latest: DevToolsTarget | undefined
    for (let attempt = 0; attempt < 75; attempt += 1) {
      latest = (await this.targets(port)).find(target => target.id === targetId)
      if (latest && latest.url !== 'about:blank') {
        if (latest.url === previousUrl) stableCount += 1
        else stableCount = 0
        previousUrl = latest.url
        if (stableCount >= 5) return latest
      }
      await delay(200)
    }
    if (!latest) throw new Error('login-check tab disappeared before it could be inspected')
    return latest
  }

  private classifyLogin(
    account: PlatformAccount,
    finalUrl: string,
    checkedAt: string,
  ): LoginCheckResult {
    const final = this.parseWebUrl(finalUrl)
    if (!final) return { state: 'unknown', message: 'The platform did not finish on an HTTP(S) page.', checkedAt }
    const login = this.parseWebUrl(account.loginUrl)
    const shop = this.parseWebUrl(account.shopUrl)
    const loginLikeUrl = /(^|[./_-])(login|signin|sign-in|passport|oauth|authorize|auth)([./?&=_-]|$)/i.test(`${final.hostname}${final.pathname}`)
    const exactLogin = Boolean(login && final.origin === login.origin && this.normalizedPath(final.pathname) === this.normalizedPath(login.pathname))
    const shopHost = Boolean(shop && this.relatedHost(final.hostname, shop.hostname))
    if (login && shop && !this.sameDocument(login.toString(), shop.toString()) && exactLogin) {
      return { state: 'invalid', message: 'The platform redirected to the configured login address.', finalUrl: this.redactUrl(final.toString()), checkedAt }
    }
    if (shopHost && !loginLikeUrl) {
      return { state: 'valid', message: 'The protected platform page opened without a login redirect.', finalUrl: this.redactUrl(final.toString()), checkedAt }
    }
    if (!shop && login && !exactLogin && !loginLikeUrl) {
      return { state: 'valid', message: 'The login address redirected to an authenticated page.', finalUrl: this.redactUrl(final.toString()), checkedAt }
    }
    if (loginLikeUrl || (exactLogin && !shop)) {
      return { state: 'invalid', message: 'The final address still appears to be a login page.', finalUrl: this.redactUrl(final.toString()), checkedAt }
    }
    return { state: 'unknown', message: 'The page opened, but the generic detector could not prove whether the session is authenticated.', finalUrl: this.redactUrl(final.toString()), checkedAt }
  }

  private async bringToFront(target: DevToolsTarget): Promise<void> {
    const session = await CdpSession.connect(target.webSocketDebuggerUrl!)
    try {
      await session.send('Page.bringToFront')
    } finally {
      session.close()
    }
  }

  private async browserProcessId(port: number, fallback: number): Promise<number> {
    try {
      const session = await CdpSession.connect((await this.version(port)).webSocketDebuggerUrl)
      try {
        const result = await session.send<{ processInfo: DevToolsProcessInfo[] }>('SystemInfo.getProcessInfo')
        const browser = result.processInfo.find(process => process.type === 'browser')
        return browser && Number.isInteger(browser.id) && browser.id > 0 ? browser.id : fallback
      } finally {
        session.close()
      }
    } catch {
      return fallback
    }
  }

  private async version(port: number): Promise<DevToolsVersion> {
    return await fetchJson<DevToolsVersion>(`http://127.0.0.1:${port}/json/version`)
  }

  private async targets(port: number): Promise<DevToolsTarget[]> {
    const targets = await fetchJson<DevToolsTarget[]>(`http://127.0.0.1:${port}/json/list`)
    return targets.filter(target => target.type === 'page' && !target.url.startsWith('devtools://'))
  }

  private async createTarget(port: number, url: string): Promise<DevToolsTarget> {
    return await fetchJson<DevToolsTarget>(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(this.safeUrl(url, true))}`, {
      method: 'PUT',
    })
  }

  private async closeTarget(port: number, targetId: string): Promise<void> {
    const session = await CdpSession.connect((await this.version(port)).webSocketDebuggerUrl)
    try {
      await session.send('Target.closeTarget', { targetId })
    } finally {
      session.close()
    }
  }

  private accountUrl(account: PlatformAccount, requestedUrl?: string): string {
    const preferred = this.safeUrl(requestedUrl || account.shopUrl || account.loginUrl || '', false)
    if (!requestedUrl) return preferred
    const candidate = new URL(preferred)
    const allowed = [account.shopUrl, account.loginUrl]
      .filter(Boolean)
      .map(value => new URL(value))
      .some(value => this.relatedHost(candidate.hostname, value.hostname))
    if (!allowed) throw new TypeError('requested URL must belong to the configured platform or login domain')
    return preferred
  }

  private belongsToAccount(value: string, account: PlatformAccount): boolean {
    const candidate = this.parseWebUrl(value)
    if (!candidate) return false
    return [account.shopUrl, account.loginUrl]
      .filter(Boolean)
      .map(url => this.parseWebUrl(url))
      .some(url => Boolean(url && this.relatedHost(candidate.hostname, url.hostname)))
  }

  private relatedHost(left: string, right: string): boolean {
    const a = left.toLowerCase()
    const b = right.toLowerCase()
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
  }

  private sameDocument(left: string, right: string): boolean {
    try {
      const a = new URL(left)
      const b = new URL(right)
      return a.origin === b.origin && this.normalizedPath(a.pathname) === this.normalizedPath(b.pathname)
    } catch {
      return left === right
    }
  }

  private normalizedPath(path: string): string {
    return path.replace(/\/+$/, '') || '/'
  }

  private parseWebUrl(value: string): URL | undefined {
    try {
      const parsed = new URL(value)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined
    } catch {
      return undefined
    }
  }

  private redactUrl(value: string): string {
    const parsed = new URL(value)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  }

  private safeUrl(value: string, allowAboutBlank = false): string {
    if (allowAboutBlank && value === 'about:blank') return value
    if (!value) throw new TypeError('a platform or login URL is required')
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('browser URL must use http or https')
    return parsed.toString()
  }

  private async resolveExecutable(browser: BrowserKind): Promise<string> {
    const configured = this.browserPaths[browser]
    const candidates = configured ? [configured] : browser === 'chrome'
      ? [
          join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : [
          join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
    for (const candidate of candidates) {
      if (!candidate) continue
      try {
        await access(candidate)
        return candidate
      } catch {
        // Continue through the platform's standard installation locations.
      }
    }
    throw new Error(`${browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} was not found`)
  }
}

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  BrowserManager,
  buildLaunchArguments,
  buildProfileActivationUrl,
  persistentCookieParam,
  type DevToolsCookie,
} from '../src/browser.js'
import type { BrowserDataDirectory, BrowserProfile, PlatformAccount } from '../src/shared.js'
import { AccountRepository, defaultKeepAlive } from '../src/store.js'

function cookie(overrides: Partial<DevToolsCookie> = {}): DevToolsCookie {
  return {
    name: 'session',
    value: 'secret',
    domain: '.example.com',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    session: true,
    sameSite: 'Lax',
    priority: 'Medium',
    sourceScheme: 'Secure',
    sourcePort: 443,
    ...overrides,
  }
}

function directory(): BrowserDataDirectory {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Test directory',
    browser: 'chrome',
    path: 'D:\\BrowserData\\test',
    managed: true,
    origin: 'plugin-created',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function account(): PlatformAccount {
  return {
    id: 'ACC-0001',
    name: 'Main',
    platformName: 'Example',
    shopUrl: 'https://admin.example.com/',
    loginUrl: 'https://login.example.com/',
    browserDataDirectoryId: directory().id,
    browserProfileId: profile().id,
    agentInstructions: '',
    loginState: 'pending',
    loginCheckState: 'unchecked',
    keepAlive: defaultKeepAlive(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function profile(overrides: Partial<BrowserProfile> = {}): BrowserProfile {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    browserDataDirectoryId: directory().id,
    directoryName: 'Profile 12',
    name: 'Operations',
    userIdentifier: 'Store operator',
    origin: 'discovered',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('launches on a fixed nonzero loopback CDP port without automation switches', () => {
  const args = buildLaunchArguments(directory(), profile(), 19321, 'https://admin.example.com/')
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'))
  assert.ok(args.includes('--remote-debugging-port=19321'))
  assert.ok(args.includes('--user-data-dir=D:\\BrowserData\\test'))
  assert.ok(args.includes('--disable-background-mode'))
  assert.ok(!args.some(argument => argument === '--remote-debugging-port=0'))
  assert.ok(!args.some(argument => argument.includes('enable-automation')))
  assert.ok(args.includes('--profile-directory=Profile 12'))
  assert.throws(() => buildLaunchArguments(directory(), profile(), 0, 'https://example.com/'), /fixed nonzero port/)
})

test('uses the configured platform URL itself as the profile activation page', () => {
  const activation = new URL(buildProfileActivationUrl('https://admin.example.com/store?tab=orders#route', 'marker-1'))
  assert.equal(activation.origin, 'https://admin.example.com')
  assert.equal(activation.pathname, '/store')
  assert.equal(activation.search, '?tab=orders')
  assert.equal(activation.hash, '#route?dsh-profile=marker-1')
  assert.doesNotMatch(activation.toString(), /dsh-profile\.invalid/)
})

test('offline login checks keep their launched profile available for the caller to manage', async () => {
  const manager = new BrowserManager({} as AccountRepository)
  const target = {
    id: 'target-1',
    type: 'page',
    title: 'Platform',
    url: 'https://admin.example.com/',
    webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/target-1',
  }
  let closed = false
  Object.assign(manager, {
    isOnline: async () => false,
    openProfileTarget: async (_directory: BrowserDataDirectory, _profile: BrowserProfile, url: string, minimized: boolean) => {
      assert.equal(url, account().shopUrl)
      assert.equal(minimized, true)
      return target
    },
    activeRuntime: async () => ({ port: 19321 }),
    waitForTarget: async () => target,
    persistSessionCookies: async () => 0,
    closeTarget: async () => { closed = true },
  })

  const result = await manager.checkLogin(account(), directory(), profile(), true)
  assert.equal(result.state, 'valid')
  assert.equal(closed, false)
})

test('online login checks still close only their temporary target', async () => {
  const manager = new BrowserManager({} as AccountRepository)
  const runtime = {
    directoryId: directory().id,
    instanceId: '33333333-3333-4333-8333-333333333333',
    browser: 'chrome',
    path: directory().path,
    pid: 1234,
    port: 19321,
    startedAt: '2026-01-01T00:00:00.000Z',
    profiles: [{
      profileId: profile().id,
      profileDirectory: profile().directoryName,
      profileName: profile().name,
      userIdentifier: profile().userIdentifier,
      browserContextId: 'context-12',
    }],
  }
  const target = {
    id: 'target-2',
    type: 'page',
    title: 'Platform',
    url: 'https://admin.example.com/',
    webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/target-2',
  }
  const closed: string[] = []
  Object.assign(manager, {
    isOnline: async () => true,
    activeRuntime: async () => runtime,
    openProfileTarget: async () => target,
    waitForTarget: async () => target,
    persistSessionCookies: async () => 0,
    closeTarget: async (_port: number, targetId: string) => { closed.push(targetId) },
  })

  const result = await manager.checkLogin(account(), directory(), profile(), true)
  assert.equal(result.state, 'valid')
  assert.deepEqual(closed, ['target-2'])
})

test('starts a second profile invocation when concurrent opens share an initially offline root', async () => {
  const manager = new BrowserManager({} as AccountRepository)
  const secondProfile = profile({
    id: '44444444-4444-4444-8444-444444444444',
    directoryName: 'Profile 13',
    name: 'Support',
    userIdentifier: 'Support operator',
  })
  const runtime = {
    directoryId: directory().id,
    instanceId: '55555555-5555-4555-8555-555555555555',
    browser: 'chrome' as const,
    path: directory().path,
    pid: 1234,
    port: 19321,
    startedAt: '2026-01-01T00:00:00.000Z',
    profiles: [] as Array<Record<string, unknown>>,
  }
  let active: typeof runtime | undefined
  let launches = 0
  let invocations = 0
  const activationUrls: string[] = []
  Object.assign(manager, {
    activeRuntime: async () => active,
    launchRoot: async (_directory: BrowserDataDirectory, _profile: BrowserProfile, activationUrl: string) => {
      launches += 1
      activationUrls.push(activationUrl)
      await new Promise(resolve => setTimeout(resolve, 10))
      active = runtime
      return runtime
    },
    targets: async () => [],
    spawnProfileInvocation: async (_directory: BrowserDataDirectory, _profile: BrowserProfile, _port: number, activationUrl: string) => {
      invocations += 1
      activationUrls.push(activationUrl)
    },
    waitForActivationTarget: async (_port: number, markerUrl: string) => ({
      id: markerUrl.includes('dsh-profile=') ? `target-${runtime.profiles.length + 1}` : 'unexpected',
      type: 'page',
      title: '',
      url: markerUrl,
      webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/target',
    }),
    contextIdForTarget: async (_port: number, targetId: string) => `context-${targetId}`,
    navigateTarget: async () => undefined,
    persistRuntimes: async () => undefined,
    startCookiePersistence: () => undefined,
  })
  await Promise.all([
    (manager as unknown as { openProfileTarget: (directory: BrowserDataDirectory, profile: BrowserProfile, url: string, minimized: boolean) => Promise<unknown> })
      .openProfileTarget(directory(), profile(), 'https://admin.example.com/', false),
    (manager as unknown as { openProfileTarget: (directory: BrowserDataDirectory, profile: BrowserProfile, url: string, minimized: boolean) => Promise<unknown> })
      .openProfileTarget(directory(), secondProfile, 'https://support.example.com/', false),
  ])
  assert.equal(launches, 1)
  assert.equal(invocations, 1)
  assert.ok(activationUrls.some(url => url.startsWith('https://admin.example.com/')))
  assert.ok(activationUrls.some(url => url.startsWith('https://support.example.com/')))
  assert.ok(activationUrls.every(url => !url.includes('dsh-profile.invalid')))
  assert.deepEqual(runtime.profiles.map(item => item.profileId), [profile().id, secondProfile.id])
})

test('closing one profile keeps the shared root and its other profile online', async () => {
  const manager = new BrowserManager({ getProfile: async () => undefined } as unknown as AccountRepository)
  const selected = profile()
  const other = profile({ id: '44444444-4444-4444-8444-444444444444', directoryName: 'Profile 13' })
  const runtime = {
    directoryId: directory().id,
    instanceId: '55555555-5555-4555-8555-555555555555',
    browser: 'chrome' as const,
    path: directory().path,
    pid: 1234,
    port: 19321,
    startedAt: '2026-01-01T00:00:00.000Z',
    profiles: [selected, other].map(item => ({
      profileId: item.id,
      profileDirectory: item.directoryName,
      profileName: item.name,
      userIdentifier: item.userIdentifier,
      browserContextId: `context-${item.id}`,
    })),
  }
  const closedTargets: string[] = []
  let rootClosed = false
  Object.assign(manager, {
    activeRuntime: async () => runtime,
    persistSessionCookies: async () => 0,
    profileTargets: async (_runtime: unknown, selectedRuntime: { profileId: string }) => [{
      id: `target-${selectedRuntime.profileId}`,
      type: 'page',
      title: '',
      url: 'https://example.com/',
    }],
    closeTarget: async (_port: number, targetId: string) => { closedTargets.push(targetId) },
    persistRuntimes: async () => undefined,
    closeRootRuntime: async () => { rootClosed = true },
  })
  await manager.closeProfile(directory(), selected)
  assert.deepEqual(closedTargets, [`target-${selected.id}`])
  assert.deepEqual(runtime.profiles.map(item => item.profileId), [other.id])
  assert.equal(rootClosed, false)
})

test('promotes domain session cookies without exposing them outside Chromium parameters', () => {
  const result = persistentCookieParam(cookie(), 2_000_000_000)
  assert.deepEqual(result, {
    name: 'session',
    value: 'secret',
    domain: '.example.com',
    path: '/',
    secure: true,
    httpOnly: true,
    expires: 2_000_000_000,
    sameSite: 'Lax',
    priority: 'Medium',
    sourceScheme: 'Secure',
    sourcePort: 443,
  })
})

test('uses a URL for host-only and __Host- cookies', () => {
  assert.equal(persistentCookieParam(cookie({ domain: 'seller.example.com' }), 10).url, 'https://seller.example.com/')
  const hostCookie = persistentCookieParam(cookie({ name: '__Host-token', domain: '.example.com' }), 10)
  assert.equal(hostCookie.url, 'https://example.com/')
  assert.equal(hostCookie.domain, undefined)
})

test('does not copy opaque partition keys', () => {
  const result = persistentCookieParam(cookie({ partitionKey: { topLevelSite: 'https://example.com' }, partitionKeyOpaque: true }), 10)
  assert.equal(result.partitionKey, undefined)
})

test('synchronizes cookies through the selected profile page target without a browser context parameter', async () => {
  const originalWebSocket = globalThis.WebSocket
  const calls: Array<{ url: string, method: string, params: Record<string, unknown> }> = []
  class FakeWebSocket {
    private listeners = new Map<string, Array<(event: { data?: string }) => void>>()
    constructor(readonly url: string) {
      queueMicrotask(() => this.emit('open', {}))
    }
    addEventListener(type: string, listener: (event: { data?: string }) => void): void {
      const listeners = this.listeners.get(type) || []
      listeners.push(listener)
      this.listeners.set(type, listeners)
    }
    send(source: string): void {
      const request = JSON.parse(source) as { id: number, method: string, params: Record<string, unknown> }
      calls.push({ url: this.url, method: request.method, params: request.params })
      const result = request.method === 'Storage.getCookies' ? { cookies: [cookie()] } : {}
      queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: request.id, result }) }))
    }
    close(): void {
      this.emit('close', {})
    }
    private emit(type: string, event: { data?: string }): void {
      for (const listener of this.listeners.get(type) || []) listener(event)
    }
  }
  Object.assign(globalThis, { WebSocket: FakeWebSocket })
  try {
    const manager = new BrowserManager({} as AccountRepository)
    const runtimeProfile = {
      profileId: profile().id,
      profileDirectory: profile().directoryName,
      profileName: profile().name,
      userIdentifier: profile().userIdentifier,
      browserContextId: 'context-12',
    }
    Object.assign(manager, {
      activeRuntime: async () => ({
        directoryId: directory().id,
        instanceId: '55555555-5555-4555-8555-555555555555',
        browser: 'chrome',
        path: directory().path,
        pid: 1234,
        port: 19321,
        startedAt: '2026-01-01T00:00:00.000Z',
        profiles: [runtimeProfile],
      }),
      profileTargets: async () => [{
        id: 'profile-page',
        type: 'page',
        title: '',
        url: 'https://admin.example.com/',
        webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/profile-page',
      }],
    })
    assert.equal(await manager.persistSessionCookies(directory(), profile()), 1)
    assert.deepEqual(calls.map(call => call.method), ['Storage.getCookies', 'Storage.setCookies'])
    assert.ok(calls.every(call => call.url.endsWith('/devtools/page/profile-page')))
    assert.ok(calls.every(call => !('browserContextId' in call.params)))
  } finally {
    Object.assign(globalThis, { WebSocket: originalWebSocket })
  }
})

test('drops stale runtime registry entries during recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-runtime-'))
  try {
    const repository = new AccountRepository(root)
    await repository.init()
    await writeFile(repository.runtimeFilename, JSON.stringify({
      version: 1,
      runtimes: [{
        directoryId: '11111111-1111-4111-8111-111111111111',
        instanceId: '22222222-2222-4222-8222-222222222222',
        browser: 'chrome',
        path: 'D:\\BrowserData\\stale',
        pid: 2147483647,
        port: 19321,
        startedAt: '2026-01-01T00:00:00.000Z',
      }],
    }))
    const manager = new BrowserManager(repository)
    await manager.init()
    const runtime = JSON.parse(await readFile(repository.runtimeFilename, 'utf8'))
    assert.deepEqual(runtime, { version: 3, runtimes: [] })
    manager.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BrowserManager, buildLaunchArguments, persistentCookieParam, type DevToolsCookie } from '../src/browser.js'
import type { BrowserDataDirectory, PlatformAccount } from '../src/shared.js'
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
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Main',
    platformName: 'Example',
    accountLabel: '',
    shopUrl: 'https://admin.example.com/',
    loginUrl: 'https://login.example.com/',
    browserDataDirectoryId: directory().id,
    agentInstructions: '',
    loginState: 'pending',
    loginCheckState: 'unchecked',
    keepAlive: defaultKeepAlive(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('launches on a fixed nonzero loopback CDP port without automation switches', () => {
  const args = buildLaunchArguments(directory(), 19321, 'https://admin.example.com/')
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'))
  assert.ok(args.includes('--remote-debugging-port=19321'))
  assert.ok(args.includes('--user-data-dir=D:\\BrowserData\\test'))
  assert.ok(args.includes('--disable-background-mode'))
  assert.ok(!args.some(argument => argument === '--remote-debugging-port=0'))
  assert.ok(!args.some(argument => argument.includes('enable-automation')))
  assert.ok(!args.some(argument => argument.startsWith('--profile-directory=')))
  assert.throws(() => buildLaunchArguments(directory(), 0, 'https://example.com/'), /fixed nonzero port/)
})

test('offline login checks launch directly on the platform instead of about:blank', async () => {
  const manager = new BrowserManager({} as AccountRepository)
  const launched: Array<{ url: string, minimized: boolean }> = []
  const target = {
    id: 'target-1',
    type: 'page',
    title: 'Platform',
    url: 'https://admin.example.com/',
    webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/target-1',
  }
  Object.assign(manager, {
    activeRuntime: async () => undefined,
    launch: async (_directory: BrowserDataDirectory, url: string, minimized: boolean) => {
      launched.push({ url, minimized })
      return {
        directoryId: directory().id,
        instanceId: '33333333-3333-4333-8333-333333333333',
        browser: 'chrome',
        path: directory().path,
        pid: 1234,
        port: 19321,
        startedAt: '2026-01-01T00:00:00.000Z',
      }
    },
    waitForLaunchedTarget: async () => target,
    waitForTarget: async () => target,
    persistSessionCookies: async () => 0,
    createTarget: async () => { throw new Error('must not create a duplicate target') },
    closeTarget: async () => { throw new Error('must not close the launched platform target') },
  })

  const result = await manager.checkLogin(account(), directory(), true)
  assert.deepEqual(launched, [{ url: 'https://admin.example.com/', minimized: true }])
  assert.equal(result.state, 'valid')
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
    activeRuntime: async () => runtime,
    launch: async () => { throw new Error('must reuse the online browser') },
    createTarget: async () => target,
    waitForTarget: async () => target,
    persistSessionCookies: async () => 0,
    closeTarget: async (_port: number, targetId: string) => { closed.push(targetId) },
  })

  const result = await manager.checkLogin(account(), directory(), true)
  assert.equal(result.state, 'valid')
  assert.deepEqual(closed, ['target-2'])
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
    assert.deepEqual(runtime, { version: 1, runtimes: [] })
    manager.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

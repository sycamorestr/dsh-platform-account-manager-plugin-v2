import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BrowserManager, buildLaunchArguments, persistentCookieParam, type DevToolsCookie } from '../src/browser.js'
import type { BrowserDataDirectory } from '../src/shared.js'
import { AccountRepository } from '../src/store.js'

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

test('launches on a fixed nonzero loopback CDP port without automation switches', () => {
  const args = buildLaunchArguments(directory(), 19321, 'https://admin.example.com/')
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'))
  assert.ok(args.includes('--remote-debugging-port=19321'))
  assert.ok(args.includes('--user-data-dir=D:\\BrowserData\\test'))
  assert.ok(!args.some(argument => argument === '--remote-debugging-port=0'))
  assert.ok(!args.some(argument => argument.includes('enable-automation')))
  assert.ok(!args.some(argument => argument.startsWith('--profile-directory=')))
  assert.throws(() => buildLaunchArguments(directory(), 0, 'https://example.com/'), /fixed nonzero port/)
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

import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrowserManager } from '../src/browser.js'
import { KeepAliveScheduler } from '../src/maintenance.js'
import type { BrowserDataDirectory, BrowserProfile, PlatformAccount } from '../src/shared.js'
import type { AccountRepository } from '../src/store.js'
import { defaultKeepAlive } from '../src/store.js'

const directory: BrowserDataDirectory = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Shared root',
  browser: 'edge',
  path: 'D:\\BrowserData\\shared',
  managed: false,
  origin: 'custom',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const profile: BrowserProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  browserDataDirectoryId: directory.id,
  directoryName: 'Profile 2',
  name: 'Requested profile',
  userIdentifier: 'Store operator',
  origin: 'discovered',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const account: PlatformAccount = {
  id: 'ACC-0001',
  name: 'Main',
  platformName: 'Example',
  shopUrl: 'https://admin.example.com/',
  loginUrl: 'https://login.example.com/',
  browserDataDirectoryId: directory.id,
  browserProfileId: profile.id,
  agentInstructions: '',
  loginState: 'pending',
  loginCheckState: 'unchecked',
  keepAlive: { ...defaultKeepAlive(), closeAfterRun: true },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

test('keep-alive closes only the temporary profile and preserves another active profile in the same data root', async () => {
  const closedProfiles: string[] = []
  let rootClosed = false
  const repository = {
    get: async () => account,
    directoryForAccount: async () => directory,
    profileForAccount: async () => profile,
    recordLoginCheck: async () => undefined,
    recordKeepAliveRun: async () => undefined,
  } as unknown as AccountRepository
  const browser = {
    isOnline: async (_directory: BrowserDataDirectory, selectedProfile?: BrowserProfile) => selectedProfile === undefined,
    checkLogin: async () => ({
      state: 'error' as const,
      message: 'browser data directory is already online with another profile',
      checkedAt: '2026-01-01T00:00:00.000Z',
    }),
    closeProfile: async (_directory: BrowserDataDirectory, selectedProfile: BrowserProfile) => { closedProfiles.push(selectedProfile.id) },
    close: async () => { rootClosed = true },
  } as unknown as BrowserManager

  const scheduler = new KeepAliveScheduler(repository, browser)
  const result = await scheduler.runNow(account.id)

  assert.equal(result.state, 'error')
  assert.deepEqual(closedProfiles, [profile.id])
  assert.equal(rootClosed, false)
})

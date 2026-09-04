import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserManager } from '../src/browser.js'
import type { BrowserDataDirectory, BrowserProfile, PlatformAccount } from '../src/shared.js'
import { defaultKeepAlive, type AccountRepository } from '../src/store.js'

const resourcesRoot = process.env.DSH_SMOKE_ROOT || tmpdir()
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '')
const root = join(resourcesRoot, `browser-manager-smoke-${runId}`)
await mkdir(root, { recursive: true })

const now = new Date().toISOString()
const directory: BrowserDataDirectory = {
  id: randomUUID(),
  name: 'BrowserManager smoke root',
  browser: 'edge',
  path: join(root, 'User Data'),
  managed: true,
  origin: 'plugin-created',
  createdAt: now,
  updatedAt: now,
}
const profiles: BrowserProfile[] = [
  {
    id: randomUUID(),
    browserDataDirectoryId: directory.id,
    directoryName: 'Default',
    name: 'Smoke profile one',
    userIdentifier: 'Smoke operator one',
    origin: 'plugin-created',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: randomUUID(),
    browserDataDirectoryId: directory.id,
    directoryName: 'Profile 1',
    name: 'Smoke profile two',
    userIdentifier: 'Smoke operator two',
    origin: 'plugin-created',
    createdAt: now,
    updatedAt: now,
  },
]
const account = (id: string, profile: BrowserProfile, suffix: string): PlatformAccount => ({
  id,
  name: `Smoke account ${suffix}`,
  platformName: 'BrowserManager smoke',
  shopUrl: `https://example.com/?dsh-smoke=${suffix}`,
  loginUrl: '',
  browserDataDirectoryId: directory.id,
  browserProfileId: profile.id,
  agentInstructions: '',
  loginState: 'pending',
  loginCheckState: 'unchecked',
  keepAlive: defaultKeepAlive(),
  createdAt: now,
  updatedAt: now,
})

const repository = {
  runtimeFilename: join(root, 'browser-runtime.json'),
  markOpened: async () => undefined,
  getProfile: async (id: string) => profiles.find(profile => profile.id === id),
} as unknown as AccountRepository
const manager = new BrowserManager(repository)

try {
  await manager.open(account('ACC-9001', profiles[0], 'one'), directory, profiles[0])
  await manager.open(account('ACC-9002', profiles[1], 'two'), directory, profiles[1])
  const bothOnline = await manager.directoryStatus(directory)
  if (!profiles.every(profile => bothOnline.onlineProfileIds.includes(profile.id))) {
    throw new Error(`expected both profiles online: ${JSON.stringify(bothOnline)}`)
  }

  await manager.closeProfile(directory, profiles[0])
  const oneOnline = await manager.directoryStatus(directory)
  if (oneOnline.onlineProfileIds.includes(profiles[0].id) || !oneOnline.onlineProfileIds.includes(profiles[1].id)) {
    throw new Error(`closing the first profile affected the wrong runtime: ${JSON.stringify(oneOnline)}`)
  }

  await manager.closeProfile(directory, profiles[1])
  const allClosed = await manager.directoryStatus(directory)
  if (allClosed.online) throw new Error(`expected root to close after its last managed profile: ${JSON.stringify(allClosed)}`)

  console.log(JSON.stringify({
    ok: true,
    root,
    simultaneousProfiles: bothOnline.onlineProfileNames,
    remainingAfterFirstClose: oneOnline.onlineProfileNames,
    rootClosedAfterLastProfile: !allClosed.online,
  }, null, 2))
} finally {
  manager.dispose()
  await manager.close(directory).catch(() => undefined)
}

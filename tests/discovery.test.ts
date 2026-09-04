import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BrowserDiscovery, inspectBrowserDataDirectory } from '../src/discovery.js'
import type { BrowserProfile } from '../src/shared.js'

async function preferences(root: string, directoryName: string, name: string): Promise<void> {
  await mkdir(join(root, directoryName), { recursive: true })
  await writeFile(join(root, directoryName, 'Preferences'), JSON.stringify({ profile: { name } }))
}

test('discovers named browser profiles and excludes guest, system, and backup folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-profile-discovery-'))
  try {
    await Promise.all([
      preferences(root, 'Default', 'Primary'),
      preferences(root, 'Profile 2', 'Store two'),
      preferences(root, 'Guest Profile', 'Guest'),
      preferences(root, 'System Profile', 'System'),
      preferences(root, 'Default_backup', 'Backup'),
    ])
    await writeFile(join(root, 'Local State'), JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: 'Main profile' },
          'Profile 2': { name: 'Business profile' },
          'Guest Profile': { name: 'Guest' },
        },
      },
    }))
    const profiles = await inspectBrowserDataDirectory('edge', root)
    assert.deepEqual(profiles.map(profile => [profile.directoryName, profile.name]), [
      ['Default', 'Main profile'],
      ['Profile 2', 'Business profile'],
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps a registered plugin profile visible before its first browser launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-profile-stored-'))
  try {
    const profile: BrowserProfile = {
      id: '11111111-1111-4111-8111-111111111111',
      browserDataDirectoryId: '22222222-2222-4222-8222-222222222222',
      directoryName: 'Default',
      name: 'Managed default',
      userIdentifier: 'Store operator',
      origin: 'plugin-created',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const profiles = await inspectBrowserDataDirectory('chrome', root, [profile])
    assert.deepEqual(profiles, [{
      directoryName: 'Default',
      name: 'Managed default',
      userIdentifier: 'Store operator',
      registeredProfileId: profile.id,
      accountCount: 0,
    }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('explicit computer scan finds bounded roots, skips excluded trees, and caches results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-computer-scan-'))
  try {
    const browserRoot = join(root, 'Users', 'operator', 'Browser Data')
    const excludedRoot = join(root, 'node_modules', 'hidden-browser')
    await Promise.all([
      preferences(browserRoot, 'Default', 'Scanned operator'),
      preferences(excludedRoot, 'Default', 'Must stay hidden'),
    ])
    await Promise.all([
      writeFile(join(browserRoot, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Scanned operator' } } } })),
      writeFile(join(excludedRoot, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Must stay hidden' } } } })),
    ])
    const discovery = new BrowserDiscovery({
      roots: async () => [root],
      maxDirectories: 100,
      maxDepth: 5,
      concurrency: 4,
    })
    const scanned = await discovery.scanComputer([], [], [])
    const scanResults = scanned.filter(candidate => candidate.source === 'scan')
    assert.equal(scanResults.length, 1)
    assert.equal(scanResults[0].path, browserRoot)
    assert.equal(scanResults[0].profiles[0].userIdentifier, 'Scanned operator')
    assert.ok(scanned.every(candidate => candidate.path !== excludedRoot))
    assert.deepEqual(await discovery.discover([], [], []), scanned)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

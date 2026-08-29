import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  AccountRepository,
  defaultKeepAlive,
  nextKeepAliveAt,
  normalizePlatformAccountInput,
  validateBrowserDataPath,
} from '../src/store.js'

const accountInput = {
  name: 'Main account',
  platformName: 'Example Platform',
  accountLabel: 'operator-a',
  shopUrl: 'https://admin.example.com/',
  loginUrl: 'https://login.example.com/',
  agentInstructions: 'Use this account for support work.',
}

test('accepts free-text platform names and validates account URLs', () => {
  const account = normalizePlatformAccountInput(accountInput)
  assert.equal(account.platformName, 'Example Platform')
  assert.equal(account.shopUrl, 'https://admin.example.com/')
  assert.throws(
    () => normalizePlatformAccountInput({ ...accountInput, shopUrl: 'file:///etc/passwd' }),
    /http or https/,
  )
  assert.throws(
    () => normalizePlatformAccountInput({ ...accountInput, shopUrl: '', loginUrl: '' }),
    /shopUrl or loginUrl is required/,
  )
})

test('requires absolute non-root browser data directory paths', () => {
  assert.throws(() => validateBrowserDataPath('relative/profile'), /must be absolute/)
  const root = resolve(tmpdir()).slice(0, 3)
  assert.throws(() => validateBrowserDataPath(root), /cannot be a drive or filesystem root/)
  assert.equal(validateBrowserDataPath(join(tmpdir(), 'dsh-profile')), resolve(tmpdir(), 'dsh-profile'))
})

test('creates accounts with new or shared browser data directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-manager-'))
  try {
    const repository = new AccountRepository(join(root, 'data'), join(root, 'browser-root'))
    await repository.init()
    const customPath = join(root, 'custom-browser-data')
    const first = await repository.create(accountInput, {
      mode: 'new',
      directory: { name: 'Shared operations', browser: 'edge', path: customPath },
    })
    const directory = await repository.directoryForAccount(first)
    assert.equal(directory.path, customPath)
    assert.equal(directory.browser, 'edge')
    assert.equal(JSON.parse(await readFile(join(customPath, '.dsh-browser-data.json'), 'utf8')).id, directory.id)

    const second = await repository.create({
      ...accountInput,
      name: 'Second account',
      platformName: 'Another Platform',
      shopUrl: 'https://console.example.net/',
    }, { mode: 'existing', id: directory.id })
    assert.equal(second.browserDataDirectoryId, directory.id)
    assert.equal((await repository.accountsForDirectory(directory.id)).length, 2)

    await assert.rejects(
      repository.create({ ...accountInput, name: 'Nested' }, {
        mode: 'new',
        directory: { path: join(customPath, 'nested') },
      }),
      /overlaps another managed directory/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects non-empty custom directories and supports archive lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-manager-'))
  try {
    const repository = new AccountRepository(join(root, 'data'))
    await repository.init()
    const nonEmpty = join(root, 'non-empty')
    await mkdir(nonEmpty)
    await writeFile(join(nonEmpty, 'existing.txt'), 'do not overwrite')
    await assert.rejects(
      repository.create(accountInput, { mode: 'new', directory: { path: nonEmpty } }),
      /must be empty/,
    )

    const created = await repository.create(accountInput, { mode: 'new', directory: { browser: 'chrome' } })
    const updated = await repository.update(created.id, { ...accountInput, name: 'Updated account' })
    assert.equal(updated.name, 'Updated account')
    await repository.archive(created.id)
    assert.equal((await repository.list()).length, 0)
    assert.equal((await repository.list({ archived: true })).length, 1)
    await repository.restore(created.id)
    assert.equal((await repository.list()).length, 1)
    const removed = await repository.remove(created.id)
    assert.equal(removed.orphanedDirectoryId, created.browserDataDirectoryId)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('migrates v1 records in place and creates an exact backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-migration-'))
  const accountId = '11111111-1111-4111-8111-111111111111'
  const createdAt = '2026-01-02T03:04:05.000Z'
  try {
    const profile = join(root, 'profiles', accountId)
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'sentinel.txt'), 'existing browser data')
    const legacy = {
      version: 1,
      accounts: [{
        id: accountId,
        name: 'Legacy store',
        platform: 'tmall',
        accountLabel: 'legacy-user',
        shopUrl: 'https://myseller.taobao.com/',
        loginUrl: 'https://login.taobao.com/',
        browser: 'chrome',
        notes: 'Legacy instructions',
        loginState: 'ready',
        createdAt,
        updatedAt: createdAt,
      }],
    }
    const source = `${JSON.stringify(legacy, null, 2)}\n`
    await writeFile(join(root, 'accounts.json'), source)

    const repository = new AccountRepository(root)
    await repository.init()

    assert.equal(await readFile(join(root, 'accounts.v1.backup.json'), 'utf8'), source)
    assert.equal(await readFile(join(profile, 'sentinel.txt'), 'utf8'), 'existing browser data')
    const migrated = JSON.parse(await readFile(join(root, 'accounts.json'), 'utf8'))
    assert.equal(migrated.version, 3)
    assert.equal(migrated.accounts[0].browserDataDirectoryId, accountId)
    assert.equal(migrated.browserDataDirectories[0].path, profile)
    assert.equal(migrated.browserDataDirectories[0].id, accountId)
    assert.equal(migrated.browserDataDirectories[0].origin, 'legacy')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('migrates v2 records to v3 with exact backup, origin inference, and unchanged paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-v2-migration-'))
  const dataDir = join(root, 'data')
  const browserRoot = join(root, 'browser-root')
  const createdAt = '2026-02-03T04:05:06.000Z'
  const pluginId = '22222222-2222-4222-8222-222222222222'
  const legacyId = '33333333-3333-4333-8333-333333333333'
  const customId = '44444444-4444-4444-8444-444444444444'
  try {
    const paths = {
      plugin: join(browserRoot, pluginId),
      legacy: join(dataDir, 'profiles', legacyId),
      custom: join(root, 'custom-data'),
    }
    for (const path of Object.values(paths)) {
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'sentinel.txt'), path)
    }
    const directory = (id: string, name: string, path: string) => ({
      id, name, browser: 'chrome', path, managed: true, createdAt, updatedAt: createdAt,
    })
    const account = (id: string, name: string, directoryId: string, loginState: string, loginCheckState: string) => ({
      id,
      name,
      platformName: 'Example',
      accountLabel: '',
      shopUrl: `https://${name.toLowerCase()}.example.com/`,
      loginUrl: '',
      browserDataDirectoryId: directoryId,
      agentInstructions: '',
      loginState,
      loginCheckState,
      createdAt,
      updatedAt: createdAt,
    })
    const v2 = {
      version: 2,
      browserDataDirectories: [
        directory(pluginId, 'Plugin', paths.plugin),
        directory(legacyId, 'Legacy', paths.legacy),
        directory(customId, 'Custom', paths.custom),
      ],
      accounts: [
        account('55555555-5555-4555-8555-555555555555', 'Ready', pluginId, 'ready', 'unchecked'),
        account('66666666-6666-4666-8666-666666666666', 'Invalid', legacyId, 'attention', 'invalid'),
        account('77777777-7777-4777-8777-777777777777', 'Pending', customId, 'pending', 'unchecked'),
      ],
    }
    await mkdir(dataDir, { recursive: true })
    const source = `${JSON.stringify(v2, null, 2)}\n`
    await writeFile(join(dataDir, 'accounts.json'), source)
    const repository = new AccountRepository(dataDir, browserRoot)
    await repository.init()

    assert.equal(await readFile(join(dataDir, 'accounts.v2.backup.json'), 'utf8'), source)
    const migrated = JSON.parse(await readFile(join(dataDir, 'accounts.json'), 'utf8'))
    assert.equal(migrated.version, 3)
    assert.deepEqual(migrated.browserDataDirectories.map((item: { origin: string }) => item.origin), ['plugin-created', 'legacy', 'custom'])
    assert.deepEqual(migrated.browserDataDirectories.map((item: { path: string }) => item.path), Object.values(paths))
    assert.equal(migrated.accounts[0].loginStatusSource, 'manual')
    assert.equal(migrated.accounts[1].loginStatusSource, 'automatic')
    for (const path of Object.values(paths)) assert.equal(await readFile(join(path, 'sentinel.txt'), 'utf8'), path)
    const legacyAccount = await repository.get('66666666-6666-4666-8666-666666666666')
    await repository.archive(legacyAccount.id)
    await repository.archiveDirectory(legacyId, { online: false })
    await assert.rejects(repository.deleteDirectory(legacyId, {
      online: false,
      deleteLocalData: true,
      confirmationName: 'Legacy',
    }), /only plugin-created/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('enforces active platform and account name uniqueness on create, update, and restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-identity-'))
  try {
    const repository = new AccountRepository(join(root, 'data'))
    await repository.init()
    const first = await repository.create(accountInput, { mode: 'new' })
    await assert.rejects(
      repository.create({ ...accountInput, name: ' main account ', platformName: 'example platform' }, { mode: 'new' }),
      /same platform name and account name/,
    )
    assert.equal((await repository.listDirectories()).length, 1)
    const second = await repository.create({
      ...accountInput,
      name: 'Second',
      platformName: 'Other',
      shopUrl: 'https://other.example.net/',
    }, { mode: 'new' })
    await assert.rejects(repository.update(second.id, accountInput), /same platform name and account name/)
    await repository.archive(first.id)
    await repository.update(second.id, accountInput)
    await assert.rejects(repository.restore(first.id), /same platform name and account name/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('renames, archives, restores, and safely unregisters custom directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-directory-lifecycle-'))
  try {
    const repository = new AccountRepository(join(root, 'data'))
    await repository.init()
    const customPath = join(root, 'custom-browser-data')
    const account = await repository.create(accountInput, { mode: 'new', directory: { path: customPath } })
    const original = await repository.directoryForAccount(account)
    const renamed = await repository.renameDirectory(original.id, 'Operations archive')
    assert.equal(renamed.name, 'Operations archive')
    assert.equal(renamed.path, original.path)
    await assert.rejects(repository.archiveDirectory(original.id, { online: false }), /archive all active accounts/)
    await repository.archive(account.id)
    await assert.rejects(repository.deleteDirectory(original.id, { online: false, deleteLocalData: false }), /must be archived/)
    await assert.rejects(repository.archiveDirectory(original.id, { online: true }), /close the browser/)
    await repository.archiveDirectory(original.id, { online: false })
    await repository.restoreDirectory(original.id)
    assert.equal((await repository.getDirectory(original.id)).archivedAt, undefined)
    await repository.archiveDirectory(original.id, { online: false })
    await assert.rejects(repository.deleteDirectory(original.id, {
      online: false,
      deleteLocalData: true,
      confirmationName: 'Operations archive',
    }), /only plugin-created/)
    const removed = await repository.deleteDirectory(original.id, { online: false, deleteLocalData: false })
    assert.equal(removed.removedArchivedAccounts.length, 1)
    assert.equal(await readFile(join(customPath, '.dsh-browser-data.json'), 'utf8').then(() => true), true)
    assert.equal((await repository.list({ archived: true })).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('physically deletes only an owned plugin-created directory after typed confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-directory-delete-'))
  try {
    const repository = new AccountRepository(join(root, 'data'), join(root, 'browser-root'))
    await repository.init()
    const account = await repository.create(accountInput, { mode: 'new', directory: { name: 'Disposable browser' } })
    const directory = await repository.directoryForAccount(account)
    await writeFile(join(directory.path, 'sentinel.txt'), 'browser data')
    await repository.archive(account.id)
    await repository.archiveDirectory(directory.id, { online: false })
    await assert.rejects(repository.deleteDirectory(directory.id, {
      online: true,
      deleteLocalData: false,
    }), /close the browser/)
    await assert.rejects(repository.deleteDirectory(directory.id, {
      online: false,
      deleteLocalData: true,
      confirmationName: 'wrong name',
    }), /confirmation name/)
    await access(join(directory.path, 'sentinel.txt'))
    const markerPath = join(directory.path, '.dsh-browser-data.json')
    const markerSource = await readFile(markerPath, 'utf8')
    const marker = JSON.parse(markerSource)
    await writeFile(markerPath, JSON.stringify({ ...marker, id: '99999999-9999-4999-8999-999999999999' }))
    await assert.rejects(repository.deleteDirectory(directory.id, {
      online: false,
      deleteLocalData: true,
      confirmationName: 'Disposable browser',
    }), /ownership marker/)
    await writeFile(markerPath, markerSource)
    const removed = await repository.deleteDirectory(directory.id, {
      online: false,
      deleteLocalData: true,
      confirmationName: 'Disposable browser',
    })
    assert.equal(removed.deletedLocalData, true)
    await assert.rejects(access(directory.path), /ENOENT/)
    assert.equal((await repository.listDirectories({ archived: true })).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('manual login confirmation clears stale automatic failure and records its source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-login-source-'))
  try {
    const repository = new AccountRepository(join(root, 'data'))
    await repository.init()
    const account = await repository.create(accountInput, { mode: 'new' })
    const checkedAt = '2026-05-06T07:08:09.000Z'
    const invalid = await repository.recordLoginCheck(account.id, { state: 'invalid', message: 'expired', checkedAt })
    assert.equal(invalid.loginStatusSource, 'automatic')
    assert.equal(invalid.loginState, 'attention')
    const manual = await repository.manualConfirmLogin(account.id)
    assert.equal(manual.loginStatusSource, 'manual')
    assert.equal(manual.loginState, 'ready')
    assert.equal(manual.loginCheckState, 'unchecked')
    assert.equal(manual.lastLoginCheckAt, undefined)
    assert.equal(manual.loginCheckMessage, undefined)
    const valid = await repository.recordLoginCheck(account.id, { state: 'valid', message: 'ok', checkedAt })
    assert.equal(valid.loginStatusSource, 'automatic')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('computes deterministic keepalive times and respects active windows', () => {
  const settings = { ...defaultKeepAlive(), intervalHours: 4, jitterMinutes: 0 }
  const from = new Date(2026, 0, 2, 8, 0, 0, 0)
  assert.equal(Date.parse(nextKeepAliveAt(settings, from, () => 0)) - from.getTime(), 4 * 60 * 60 * 1000)

  const windowed = { ...settings, intervalHours: 1, activeStart: '09:00', activeEnd: '17:00' }
  const evening = new Date(2026, 0, 2, 18, 0, 0, 0)
  const next = new Date(nextKeepAliveAt(windowed, evening, () => 0))
  assert.equal(next.getDate(), 3)
  assert.equal(next.getHours(), 9)
  assert.equal(next.getMinutes(), 0)
})

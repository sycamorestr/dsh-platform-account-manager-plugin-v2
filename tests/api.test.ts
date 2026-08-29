import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { publicState } from '../src/api.js'
import type { BrowserManager } from '../src/browser.js'
import { AccountRepository } from '../src/store.js'

test('public state decorates archived accounts through archived directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-api-state-'))
  try {
    const repository = new AccountRepository(join(root, 'data'))
    await repository.init()
    const account = await repository.create({
      name: 'Main',
      platformName: 'Example',
      shopUrl: 'https://admin.example.com/',
    }, { mode: 'new' })
    const directory = await repository.directoryForAccount(account)
    await repository.archive(account.id)
    await repository.archiveDirectory(directory.id, { online: false })
    const browser = {
      async directoryStatus() {
        return { online: false, pages: 0, cookieSync: { state: 'idle', persistedCount: 0 } }
      },
      async platformStatus() {
        return { browserOnline: false, platformOpen: false, pages: 0 }
      },
    } as unknown as BrowserManager

    const state = await publicState(repository, browser)
    assert.equal(state.directories.length, 0)
    assert.equal(state.archivedDirectories.length, 1)
    assert.equal(state.archivedDirectories[0].activeAccountCount, 0)
    assert.equal(state.archivedDirectories[0].archivedAccountCount, 1)
    assert.equal(state.archivedAccounts[0].directory.id, directory.id)
    assert.ok(state.archivedAccounts[0].directory.archivedAt)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

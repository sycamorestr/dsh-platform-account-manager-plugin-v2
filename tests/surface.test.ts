import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { agentAccountView } from '../src/tools.js'
import { defaultKeepAlive } from '../src/store.js'

test('agent tools expose session management only', async () => {
  const source = await readFile(new URL('../src/tools.ts', import.meta.url), 'utf8')
  const names = [...source.matchAll(/name:\s*'([^']+)'/g)].map(match => match[1])
  assert.deepEqual(names, [
    'platform_account_list',
    'platform_account_open',
    'platform_account_check_login',
    'platform_browser_close',
  ])
  assert.doesNotMatch(source, /store_page_snapshot|store_page_action|name:\s*'[^']*(click|type|press|snapshot|navigate)/i)
})

test('login checking does not extract page text or DOM snapshots', async () => {
  const source = await readFile(new URL('../src/browser.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /innerText|outerHTML|DOMSnapshot|querySelector|Runtime\.evaluate/)
})

test('agent account summaries identify accounts without exposing local or login details', () => {
  const view = agentAccountView({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Main',
    platformName: 'Example',
    accountLabel: 'private-login-name',
    shopUrl: 'https://admin.example.com/',
    loginUrl: 'https://login.example.com/',
    browserDataDirectoryId: '22222222-2222-4222-8222-222222222222',
    agentInstructions: 'Support only',
    loginState: 'ready',
    loginStatusSource: 'manual',
    loginCheckState: 'unchecked',
    keepAlive: defaultKeepAlive(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }, { browserOnline: true, platformOpen: true, pages: 1, currentUrl: 'https://admin.example.com/private' })
  assert.equal(view.platformName, 'Example')
  assert.equal(view.name, 'Main')
  assert.deepEqual(Object.keys(view), [
    'id',
    'platformName',
    'name',
    'loginState',
    'loginStatusSource',
    'loginCheckState',
    'lastLoginCheckAt',
    'lastLoginValidAt',
    'keepAlive',
    'agentInstructions',
    'browserStatus',
  ])
  assert.ok(!('accountLabel' in view))
  assert.ok(!('shopUrl' in view))
  assert.ok(!('loginUrl' in view))
  assert.ok(!('browserDataDirectoryId' in view))
  assert.ok(!('currentUrl' in view.browserStatus))
})

test('client consolidates manual confirmation into the login result flow', async () => {
  const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /'login-state'/)
  assert.match(source, /'manual-confirm-login'/)
  assert.match(source, /result\.state === 'unknown' \|\| result\.state === 'error'/)
  assert.match(source, /'archive-directory'/)
  assert.match(source, /'delete-directory'/)
})

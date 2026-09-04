import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { BrowserManager } from './browser.js'
import type { PlatformAccount, PlatformStatus } from './shared.js'
import type { AccountRepository } from './store.js'

const output = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue
}

function accountId(value: string | undefined): string {
  if (!value || !/^ACC-\d{4,}$/.test(value)) throw new TypeError('valid account_id is required')
  return value
}

export function agentAccountView(account: PlatformAccount, browserStatus: PlatformStatus) {
  return {
    id: account.id,
    platformName: account.platformName,
    name: account.name,
    loginState: account.loginState,
    loginStatusSource: account.loginStatusSource ?? null,
    loginCheckState: account.loginCheckState,
    lastLoginCheckAt: account.lastLoginCheckAt ?? null,
    lastLoginValidAt: account.lastLoginValidAt ?? null,
    keepAlive: {
      enabled: account.keepAlive.enabled,
      nextRunAt: account.keepAlive.nextRunAt ?? null,
      lastResult: account.keepAlive.lastResult ?? null,
    },
    agentInstructions: account.agentInstructions,
    browserStatus: {
      browserOnline: browserStatus.browserOnline,
      platformOpen: browserStatus.platformOpen,
      pages: browserStatus.pages,
    },
  }
}

export function registerTools(ctx: Context, repository: AccountRepository, browser: BrowserManager): void {
  ctx.tools.register(defineTool({
    name: 'platform_account_list',
    description: 'List locally configured platform accounts and their login/session status. Identify an account by platformName plus name, then use its id for later calls. Browser directories, paths, debugging ports, account labels, URLs, passwords, and cookies are never returned.',
    parameters: {
      account_id: { type: 'string', description: 'Optional platform account id to return one account only.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args) {
      const selected = args.account_id ? accountId(args.account_id) : undefined
      const accounts = selected ? [await repository.get(selected)] : await repository.list()
      return asJsonValue(await Promise.all(accounts.map(async account => {
        const directory = await repository.directoryForAccount(account)
        return agentAccountView(account, await browser.platformStatus(account, directory, await repository.profileForAccount(account)))
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'platform_account_open',
    description: 'Open the configured backend or login page for one platform account in its managed local browser data directory. The user completes authentication manually; never request or handle their password.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id from platform_account_list.' },
    },
    output,
    timeoutMs: 30000,
    async execute(args) {
      const account = await repository.get(accountId(args.account_id))
      const directory = await repository.directoryForAccount(account)
      const status = await browser.open(account, directory, await repository.profileForAccount(account))
      return asJsonValue({
        accountId: account.id,
        opened: true,
        status: {
          browserOnline: status.browserOnline,
          platformOpen: status.platformOpen,
          pages: status.pages,
        },
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'platform_account_check_login',
    description: 'Check whether one platform account still appears authenticated by opening only its configured backend URL in a temporary tab. This does not click, type, solve verification, or perform general page automation.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id from platform_account_list.' },
    },
    output,
    timeoutMs: 45000,
    async execute(args) {
      const account = await repository.get(accountId(args.account_id))
      const directory = await repository.directoryForAccount(account)
      const profile = await repository.profileForAccount(account)
      const wasOnline = await browser.isOnline(directory, profile)
      try {
        const result = await browser.checkLogin(account, directory, profile, true)
        await repository.recordLoginCheck(account.id, result)
        return asJsonValue({
          accountId: account.id,
          state: result.state,
          message: result.message,
          checkedAt: result.checkedAt,
        })
      } finally {
        if (!wasOnline) await browser.closeProfile(directory, profile).catch(() => undefined)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'platform_browser_close',
    description: 'Close the bound browser Profile for a platform account after syncing session cookies. Other Profiles in the same browser data root remain online.',
    parameters: {
      account_id: { type: 'string', required: true, description: 'Account id from platform_account_list.' },
    },
    output,
    timeoutMs: 30000,
    async execute(args) {
      const account = await repository.get(accountId(args.account_id))
      const directory = await repository.directoryForAccount(account)
      const profile = await repository.profileForAccount(account)
      const affected = (await repository.accountsForProfile(profile.id)).map(candidate => ({ id: candidate.id, name: candidate.name }))
      await browser.closeProfile(directory, profile)
      return asJsonValue({ closed: true, affectedAccounts: affected })
    },
  }))

  ctx.on('tools/pre-execute', async (execution, next) => {
    if (execution.name !== 'platform_browser_close') return next()
    return {
      kind: 'ask',
      reason: 'Closing this browser Profile may close pages for multiple platform accounts that share it.',
    }
  })
}

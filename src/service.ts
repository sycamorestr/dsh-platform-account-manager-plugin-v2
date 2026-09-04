import { Service, type Context } from '@deepseek-ai/cordis'
import type { BrowserManager, TrustedBrowserConnection } from './browser.js'
import type { LoginCheckResult, PlatformAccount, PlatformStatus } from './shared.js'
import type { AccountRepository } from './store.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    platformSessions: PlatformSessionService
  }
}

export class PlatformSessionService extends Service {
  constructor(ctx: Context, private repository: AccountRepository, private browser: BrowserManager) {
    super(ctx, 'platformSessions')
  }

  async list(): Promise<PlatformAccount[]> {
    return await this.repository.list()
  }

  async open(accountId: string): Promise<PlatformStatus> {
    const account = await this.repository.get(accountId)
    return await this.browser.open(
      account,
      await this.repository.directoryForAccount(account),
      await this.repository.profileForAccount(account),
    )
  }

  async close(accountId: string): Promise<void> {
    const account = await this.repository.get(accountId)
    await this.browser.closeProfile(
      await this.repository.directoryForAccount(account),
      await this.repository.profileForAccount(account),
    )
  }

  async checkLogin(accountId: string): Promise<LoginCheckResult> {
    const account = await this.repository.get(accountId)
    const directory = await this.repository.directoryForAccount(account)
    const profile = await this.repository.profileForAccount(account)
    const wasProfileOnline = await this.browser.isOnline(directory, profile)
    try {
      const result = await this.browser.checkLogin(account, directory, profile, true)
      await this.repository.recordLoginCheck(account.id, result)
      return result
    } finally {
      if (!wasProfileOnline) await this.browser.closeProfile(directory, profile).catch(() => undefined)
    }
  }

  async connection(accountId: string): Promise<TrustedBrowserConnection> {
    const account = await this.repository.get(accountId)
    return await this.browser.trustedConnection(
      account,
      await this.repository.directoryForAccount(account),
      await this.repository.profileForAccount(account),
    )
  }
}

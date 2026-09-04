import type { BrowserManager } from './browser.js'
import type { KeepAliveResult, LoginCheckResult, PlatformAccount } from './shared.js'
import type { AccountRepository } from './store.js'

function keepAliveResult(result: LoginCheckResult): KeepAliveResult {
  if (result.state === 'valid') return 'success'
  if (result.state === 'invalid') return 'invalid'
  if (result.state === 'unknown') return 'unknown'
  return 'error'
}

export class KeepAliveScheduler {
  private running = false

  constructor(private repository: AccountRepository, private browser: BrowserManager) {}

  async tick(now = new Date()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const due = await this.repository.dueKeepAliveAccounts(now)
      const groups = new Map<string, PlatformAccount[]>()
      for (const account of due) {
        const accounts = groups.get(account.browserProfileId) || []
        accounts.push(account)
        groups.set(account.browserProfileId, accounts)
      }
      for (const accounts of groups.values()) await this.runGroup(accounts)
    } finally {
      this.running = false
    }
  }

  async runNow(accountId: string): Promise<LoginCheckResult> {
    const account = await this.repository.get(accountId)
    const directory = await this.repository.directoryForAccount(account)
    const profile = await this.repository.profileForAccount(account)
    const wasProfileOnline = await this.browser.isOnline(directory, profile)
    try {
      const result = await this.browser.checkLogin(account, directory, profile, true)
      await this.repository.recordLoginCheck(account.id, result)
      await this.repository.recordKeepAliveRun(account.id, keepAliveResult(result), result.message)
      return result
    } finally {
      if (!wasProfileOnline && account.keepAlive.closeAfterRun) {
        await this.browser.closeProfile(directory, profile).catch(() => undefined)
      }
    }
  }

  private async runGroup(accounts: PlatformAccount[]): Promise<void> {
    if (!accounts.length) return
    const directory = await this.repository.getDirectory(accounts[0].browserDataDirectoryId)
    const profile = await this.repository.getProfile(accounts[0].browserProfileId)
    const wasProfileOnline = await this.browser.isOnline(directory, profile)
    try {
      for (const account of accounts) {
        const result = await this.browser.checkLogin(account, directory, profile, true)
        await this.repository.recordLoginCheck(account.id, result)
        await this.repository.recordKeepAliveRun(account.id, keepAliveResult(result), result.message)
      }
    } finally {
      if (!wasProfileOnline && accounts.every(account => account.keepAlive.closeAfterRun)) {
        await this.browser.closeProfile(directory, profile).catch(() => undefined)
      }
    }
  }
}

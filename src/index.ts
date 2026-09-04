import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type {} from '@deepseek-ai/dsh-host-directory-picker'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { apiRoute, createApiHandler } from './api.js'
import { BrowserManager } from './browser.js'
import { BrowserDiscovery } from './discovery.js'
import { KeepAliveScheduler } from './maintenance.js'
import { PlatformSessionService } from './service.js'
import { AccountRepository } from './store.js'
import { registerTools } from './tools.js'

const defaultDshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const defaultDataDir = join(defaultDshHome, 'store-account-manager')

export interface Config {
  dataDir: string
  browserDataRoot: string
  cookieRetentionDays: number
  chromePath?: string
  edgePath?: string
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default(defaultDataDir),
  browserDataRoot: Schema.string().default(join(defaultDataDir, 'browser-data')),
  cookieRetentionDays: Schema.number().min(1).max(3650).step(1).default(365),
  chromePath: Schema.string(),
  edgePath: Schema.string(),
})

export const name = 'platform-account-manager'
export const inject = ['tools', 'webServer', 'timer', 'directoryPicker']

export async function apply(ctx: Context, config: Config): Promise<void> {
  const repository = new AccountRepository(resolve(config.dataDir), resolve(config.browserDataRoot))
  await repository.init()
  const browser = new BrowserManager(repository, {
    cookieRetentionDays: config.cookieRetentionDays,
    browserPaths: {
      ...(config.chromePath ? { chrome: resolve(config.chromePath) } : {}),
      ...(config.edgePath ? { edge: resolve(config.edgePath) } : {}),
    },
  })
  await browser.init()
  ctx.effect(() => () => browser.dispose(), 'platform-manager: browser lifecycle')

  const scheduler = new KeepAliveScheduler(repository, browser)
  const discovery = new BrowserDiscovery()
  const logger = ctx.logger('platform-manager')
  ctx.interval(() => {
    void scheduler.tick().catch(error => logger.error(error))
  }, 60000)
  void scheduler.tick().catch(error => logger.error(error))

  new PlatformSessionService(ctx, repository, browser)
  registerTools(ctx, repository, browser)
  ctx.effect(() => ctx.webServer.register({
    ...apiRoute,
    handler: createApiHandler(repository, browser, scheduler, ctx.directoryPicker, discovery),
  }), 'platform-manager: local API')
}

export { PlatformSessionService } from './service.js'
export type { TrustedBrowserConnection } from './browser.js'

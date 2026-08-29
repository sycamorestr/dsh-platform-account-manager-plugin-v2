export const BROWSERS = ['chrome', 'edge'] as const
export type BrowserKind = typeof BROWSERS[number]

export const LOGIN_STATES = ['pending', 'ready', 'attention'] as const
export type LoginState = typeof LOGIN_STATES[number]

export const LOGIN_CHECK_STATES = ['unchecked', 'valid', 'invalid', 'unknown', 'error'] as const
export type LoginCheckState = typeof LOGIN_CHECK_STATES[number]

export const LOGIN_STATUS_SOURCES = ['automatic', 'manual'] as const
export type LoginStatusSource = typeof LOGIN_STATUS_SOURCES[number]

export const BROWSER_DATA_DIRECTORY_ORIGINS = ['plugin-created', 'custom', 'legacy'] as const
export type BrowserDataDirectoryOrigin = typeof BROWSER_DATA_DIRECTORY_ORIGINS[number]

export const KEEP_ALIVE_RESULTS = ['success', 'invalid', 'unknown', 'error'] as const
export type KeepAliveResult = typeof KEEP_ALIVE_RESULTS[number]

export interface KeepAliveSettings {
  enabled: boolean
  intervalHours: number
  jitterMinutes: number
  activeStart: string
  activeEnd: string
  closeAfterRun: boolean
  nextRunAt?: string
  lastRunAt?: string
  lastResult?: KeepAliveResult
  lastMessage?: string
  consecutiveFailures: number
}

export interface BrowserDataDirectory {
  id: string
  name: string
  browser: BrowserKind
  path: string
  managed: boolean
  origin: BrowserDataDirectoryOrigin
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface PlatformAccount {
  id: string
  name: string
  platformName: string
  accountLabel: string
  shopUrl: string
  loginUrl: string
  browserDataDirectoryId: string
  agentInstructions: string
  loginState: LoginState
  loginCheckState: LoginCheckState
  loginStatusSource?: LoginStatusSource
  lastLoginCheckAt?: string
  lastLoginValidAt?: string
  loginCheckMessage?: string
  keepAlive: KeepAliveSettings
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
  archivedAt?: string
}

export interface PlatformAccountInput {
  name: string
  platformName: string
  accountLabel?: string
  shopUrl?: string
  loginUrl?: string
  browserDataDirectoryId?: string
  agentInstructions?: string
}

export interface NewBrowserDataDirectoryInput {
  name?: string
  browser?: BrowserKind
  path?: string
}

export type BrowserDirectorySelection =
  | { mode: 'existing', id: string }
  | { mode: 'new', directory?: NewBrowserDataDirectoryInput }

export interface CookieSyncStatus {
  state: 'idle' | 'ok' | 'error'
  lastSyncedAt?: string
  persistedCount: number
  error?: string
}

export interface BrowserDirectoryStatus {
  online: boolean
  pages: number
  pid?: number
  startedAt?: string
  cookieSync: CookieSyncStatus
}

export interface PlatformStatus {
  browserOnline: boolean
  platformOpen: boolean
  pages: number
  currentUrl?: string
}

export interface PublicBrowserDataDirectory extends BrowserDataDirectory {
  accountCount: number
  activeAccountCount: number
  archivedAccountCount: number
  status: BrowserDirectoryStatus
}

export interface PublicPlatformAccount extends PlatformAccount {
  directory: BrowserDataDirectory
  status: PlatformStatus
}

export interface AccountDocument {
  version: 3
  browserDataDirectories: BrowserDataDirectory[]
  accounts: PlatformAccount[]
}

export interface LoginCheckResult {
  state: Exclude<LoginCheckState, 'unchecked'>
  message: string
  finalUrl?: string
  checkedAt: string
}

export const PLATFORM_PRESETS = [
  { name: '淘宝', shopUrl: 'https://myseller.taobao.com/', loginUrl: 'https://myseller.taobao.com/' },
  { name: '天猫', shopUrl: 'https://myseller.taobao.com/', loginUrl: 'https://myseller.taobao.com/' },
  { name: '1688', shopUrl: 'https://work.1688.com/', loginUrl: 'https://work.1688.com/' },
  { name: 'Alibaba.com', shopUrl: 'https://seller.alibaba.com/', loginUrl: 'https://seller.alibaba.com/' },
  { name: 'Shopify', shopUrl: 'https://admin.shopify.com/', loginUrl: 'https://admin.shopify.com/' },
  { name: '抖音电商', shopUrl: '', loginUrl: '' },
  { name: '拼多多', shopUrl: '', loginUrl: '' },
  { name: 'Amazon', shopUrl: '', loginUrl: '' },
] as const

export function browserLabel(browser: BrowserKind): string {
  return browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'
}

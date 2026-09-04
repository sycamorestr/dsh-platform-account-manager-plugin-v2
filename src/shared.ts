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

export const BROWSER_PROFILE_ORIGINS = ['plugin-created', 'discovered', 'legacy'] as const
export type BrowserProfileOrigin = typeof BROWSER_PROFILE_ORIGINS[number]

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

export interface BrowserProfile {
  id: string
  browserDataDirectoryId: string
  directoryName: string
  name: string
  userIdentifier: string
  origin: BrowserProfileOrigin
  createdAt: string
  updatedAt: string
}

export interface PlatformAccount {
  id: string
  name: string
  platformName: string
  shopUrl: string
  loginUrl: string
  browserDataDirectoryId: string
  browserProfileId: string
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
  shopUrl?: string
  loginUrl?: string
  browserDataDirectoryId?: string
  browserProfileId?: string
  agentInstructions?: string
}

export interface NewBrowserDataDirectoryInput {
  name?: string
  browser?: BrowserKind
  path?: string
  profileUserIdentifier?: string
}

export type BrowserDirectorySelection =
  | {
      mode: 'existing'
      id: string
      profileDirectory: string
      profileName?: string
      profileUserIdentifier?: string
    }
  | {
      mode: 'discovered'
      browser: BrowserKind
      path: string
      name?: string
      profileDirectory: string
      profileName?: string
      profileUserIdentifier?: string
    }
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
  onlineProfileIds: string[]
  onlineProfileNames: string[]
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

export interface PublicBrowserProfile extends BrowserProfile {
  accountCount: number
  activeAccountCount: number
  archivedAccountCount: number
  exists: boolean
  online: boolean
  cookieSync: CookieSyncStatus
}

export interface PublicPlatformAccount extends PlatformAccount {
  directory: BrowserDataDirectory
  profile: BrowserProfile
  status: PlatformStatus
}

export type BrowserDirectoryDiscoverySource = 'standard' | 'registered' | 'manual' | 'scan'

export interface DiscoveredBrowserProfile {
  directoryName: string
  name: string
  userIdentifier: string
  registeredProfileId?: string
  accountCount: number
}

export interface DiscoveredBrowserDataDirectory {
  key: string
  name: string
  browser: BrowserKind
  path: string
  source: BrowserDirectoryDiscoverySource
  registeredDirectoryId?: string
  profiles: DiscoveredBrowserProfile[]
}

export interface AccountDocument {
  version: 5
  nextAccountNumber: number
  browserDataDirectories: BrowserDataDirectory[]
  browserProfiles: BrowserProfile[]
  accounts: PlatformAccount[]
}

export interface LoginCheckResult {
  state: Exclude<LoginCheckState, 'unchecked'>
  message: string
  finalUrl?: string
  checkedAt: string
}

export function browserLabel(browser: BrowserKind): string {
  return browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'
}

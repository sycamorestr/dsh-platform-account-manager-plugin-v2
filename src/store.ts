import { randomUUID } from 'node:crypto'
import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, parse, resolve, sep } from 'node:path'
import {
  BROWSERS,
  BROWSER_DATA_DIRECTORY_ORIGINS,
  BROWSER_PROFILE_ORIGINS,
  KEEP_ALIVE_RESULTS,
  LOGIN_CHECK_STATES,
  LOGIN_STATES,
  LOGIN_STATUS_SOURCES,
  type AccountDocument,
  type BrowserDataDirectory,
  type BrowserDirectorySelection,
  type BrowserKind,
  type BrowserDataDirectoryOrigin,
  type BrowserProfile,
  type BrowserProfileOrigin,
  type KeepAliveResult,
  type KeepAliveSettings,
  type LoginCheckResult,
  type LoginCheckState,
  type NewBrowserDataDirectoryInput,
  type PlatformAccount,
  type PlatformAccountInput,
} from './shared.js'
import { inspectBrowserDataDirectory } from './discovery.js'

const MAX_NAME = 120
const MAX_PLATFORM = 100
const MAX_INSTRUCTIONS = 4000
const MARKER_FILENAME = '.dsh-browser-data.json'

interface LegacyAccountDocument {
  version: 1
  accounts: Array<Record<string, unknown>>
}

interface V2AccountDocument {
  version: 2
  browserDataDirectories: Array<Record<string, unknown>>
  accounts: Array<Record<string, unknown>>
}

interface V4PlatformAccount extends Omit<PlatformAccount, 'id'> {
  id: string
  accountLabel: string
}

interface V4BrowserProfile extends Omit<BrowserProfile, 'userIdentifier'> {}

interface V4AccountDocument {
  version: 4
  browserDataDirectories: BrowserDataDirectory[]
  browserProfiles: V4BrowserProfile[]
  accounts: V4PlatformAccount[]
}

interface V3PlatformAccount extends Omit<V4PlatformAccount, 'browserProfileId'> {}

interface V3AccountDocument {
  version: 3
  browserDataDirectories: BrowserDataDirectory[]
  accounts: V3PlatformAccount[]
}

export interface DirectoryMutationContext {
  online: boolean
}

export interface DeleteDirectoryOptions extends DirectoryMutationContext {
  deleteLocalData: boolean
  confirmationName?: string
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new TypeError(`${field} is required`)
    return ''
  }
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (required && !normalized) throw new TypeError(`${field} is required`)
  if (normalized.length > max) throw new TypeError(`${field} is longer than ${max} characters`)
  return normalized
}

function multilineText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  const normalized = value.replace(/\u0000/g, '').trim()
  if (normalized.length > max) throw new TypeError(`${field} is longer than ${max} characters`)
  return normalized
}

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new TypeError(`${field} must be one of: ${values.join(', ')}`)
  }
  return value as T
}

function uuid(value: unknown, field: string): string {
  const normalized = text(value, field, 80, true)
  if (!/^[0-9a-f-]{36}$/i.test(normalized)) throw new TypeError(`${field} must be a UUID`)
  return normalized
}

function accountId(value: unknown, field = 'account id'): string {
  const normalized = text(value, field, 32, true).toUpperCase()
  if (!/^ACC-\d{4,}$/.test(normalized)) throw new TypeError(`${field} must use ACC-0001 format`)
  return normalized
}

function webUrl(value: unknown, field: string): string {
  const normalized = text(value, field, 2048)
  if (!normalized) return ''
  const parsed = new URL(normalized)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`${field} must use http or https`)
  }
  return parsed.toString()
}

function iso(value: unknown, field: string): string {
  const normalized = text(value, field, 64, true)
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${field} must be an ISO timestamp`)
  return normalized
}

function optionalIso(value: unknown, field: string): string | undefined {
  return value ? iso(value, field) : undefined
}

function timeOfDay(value: unknown, field: string, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = text(value, field, 5, true)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) throw new TypeError(`${field} must use HH:mm`)
  return normalized
}

function boundedNumber(value: unknown, field: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new TypeError(`${field} must be between ${minimum} and ${maximum}`)
  }
  return number
}

export function defaultKeepAlive(): KeepAliveSettings {
  return {
    enabled: false,
    intervalHours: 24,
    jitterMinutes: 15,
    activeStart: '00:00',
    activeEnd: '23:59',
    closeAfterRun: true,
    consecutiveFailures: 0,
  }
}

export function normalizeKeepAlive(value: unknown, current: KeepAliveSettings = defaultKeepAlive()): KeepAliveSettings {
  if (value === undefined || value === null) return { ...current }
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('keepAlive must be an object')
  const raw = value as Record<string, unknown>
  return {
    enabled: raw.enabled === undefined ? current.enabled : Boolean(raw.enabled),
    intervalHours: boundedNumber(raw.intervalHours, 'intervalHours', current.intervalHours, 1, 720),
    jitterMinutes: boundedNumber(raw.jitterMinutes, 'jitterMinutes', current.jitterMinutes, 0, 240),
    activeStart: timeOfDay(raw.activeStart, 'activeStart', current.activeStart),
    activeEnd: timeOfDay(raw.activeEnd, 'activeEnd', current.activeEnd),
    closeAfterRun: raw.closeAfterRun === undefined ? current.closeAfterRun : Boolean(raw.closeAfterRun),
    ...(optionalIso(raw.nextRunAt, 'nextRunAt') ? { nextRunAt: optionalIso(raw.nextRunAt, 'nextRunAt') } : {}),
    ...(optionalIso(raw.lastRunAt, 'lastRunAt') ? { lastRunAt: optionalIso(raw.lastRunAt, 'lastRunAt') } : {}),
    ...(raw.lastResult ? { lastResult: oneOf(raw.lastResult, KEEP_ALIVE_RESULTS, 'lastResult') } : {}),
    ...(raw.lastMessage ? { lastMessage: text(raw.lastMessage, 'lastMessage', 1000) } : {}),
    consecutiveFailures: boundedNumber(raw.consecutiveFailures, 'consecutiveFailures', current.consecutiveFailures, 0, 1000),
  }
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function moveToMinute(date: Date, minute: number, nextDay = false): Date {
  const result = new Date(date)
  if (nextDay) result.setDate(result.getDate() + 1)
  result.setHours(Math.floor(minute / 60), minute % 60, 0, 0)
  return result
}

export function nextKeepAliveAt(
  settings: KeepAliveSettings,
  from = new Date(),
  random: () => number = Math.random,
  intervalMultiplier = 1,
): string {
  const jitter = Math.floor(random() * (settings.jitterMinutes * 60 * 1000 + 1))
  let target = new Date(from.getTime() + settings.intervalHours * intervalMultiplier * 60 * 60 * 1000 + jitter)
  const start = minutesOfDay(settings.activeStart)
  const end = minutesOfDay(settings.activeEnd)
  const targetMinute = target.getHours() * 60 + target.getMinutes()
  if (start <= end) {
    if (targetMinute < start) target = moveToMinute(target, start)
    else if (targetMinute > end) target = moveToMinute(target, start, true)
  } else if (targetMinute > end && targetMinute < start) {
    target = moveToMinute(target, start)
  }
  return target.toISOString()
}

export function normalizePlatformAccountInput(value: unknown): Required<PlatformAccountInput> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('account must be an object')
  }
  const input = value as Record<string, unknown>
  const normalized = {
    name: text(input.name, 'name', MAX_NAME, true),
    platformName: text(input.platformName, 'platformName', MAX_PLATFORM, true),
    shopUrl: webUrl(input.shopUrl, 'shopUrl'),
    loginUrl: webUrl(input.loginUrl, 'loginUrl'),
    browserDataDirectoryId: input.browserDataDirectoryId ? uuid(input.browserDataDirectoryId, 'browserDataDirectoryId') : '',
    browserProfileId: input.browserProfileId ? uuid(input.browserProfileId, 'browserProfileId') : '',
    agentInstructions: multilineText(input.agentInstructions, 'agentInstructions', MAX_INSTRUCTIONS),
  }
  if (!normalized.shopUrl && !normalized.loginUrl) {
    throw new TypeError('shopUrl or loginUrl is required')
  }
  return normalized
}

function normalizedPathKey(value: string): string {
  const normalized = normalize(resolve(value)).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isSameOrNested(left: string, right: string): boolean {
  const a = `${normalizedPathKey(left)}${sep}`
  const b = `${normalizedPathKey(right)}${sep}`
  return a.startsWith(b) || b.startsWith(a)
}

function accountIdentityKey(platformName: string, name: string): string {
  return `${platformName.normalize('NFKC').toLocaleLowerCase()}\u0000${name.normalize('NFKC').toLocaleLowerCase()}`
}

function assertUniqueActiveAccount(
  document: AccountDocument,
  account: Pick<PlatformAccountInput, 'platformName' | 'name'>,
  excludeId?: string,
): void {
  const key = accountIdentityKey(account.platformName, account.name)
  if (document.accounts.some(candidate => !candidate.archivedAt && candidate.id !== excludeId
    && accountIdentityKey(candidate.platformName, candidate.name) === key)) {
    throw new TypeError('an active account with the same platform name and account name already exists')
  }
}

export function validateBrowserDataPath(value: unknown): string {
  const candidate = text(value, 'browser data directory path', 2048, true)
  if (!isAbsolute(candidate)) throw new TypeError('browser data directory path must be absolute')
  if (candidate.startsWith('\\\\')) throw new TypeError('network browser data directories are not supported')
  const resolved = resolve(candidate)
  if (normalizedPathKey(resolved) === normalizedPathKey(parse(resolved).root)) {
    throw new TypeError('browser data directory cannot be a drive or filesystem root')
  }
  const forbidden = [process.env.WINDIR, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.PROGRAMDATA]
    .filter((path): path is string => Boolean(path))
  if (forbidden.some(path => normalizedPathKey(resolved) === normalizedPathKey(path) || normalizedPathKey(resolved).startsWith(`${normalizedPathKey(path)}${sep}`))) {
    throw new TypeError('browser data directory cannot be inside a system or program directory')
  }
  return resolved
}

function normalizeStoredDirectory(value: unknown, inferredOrigin?: BrowserDataDirectoryOrigin): BrowserDataDirectory {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('stored browser data directory must be an object')
  const raw = value as Record<string, unknown>
  return {
    id: uuid(raw.id, 'directory id'),
    name: text(raw.name, 'directory name', MAX_NAME, true),
    browser: oneOf(raw.browser, BROWSERS, 'browser'),
    path: validateBrowserDataPath(raw.path),
    managed: raw.managed !== false,
    origin: inferredOrigin ?? oneOf(raw.origin, BROWSER_DATA_DIRECTORY_ORIGINS, 'directory origin'),
    createdAt: iso(raw.createdAt, 'directory createdAt'),
    updatedAt: iso(raw.updatedAt, 'directory updatedAt'),
    ...(raw.archivedAt ? { archivedAt: iso(raw.archivedAt, 'directory archivedAt') } : {}),
  }
}

export function validateProfileDirectoryName(value: unknown): string {
  const directoryName = text(value, 'profile directory', 160, true)
  if (directoryName === '.' || directoryName === '..' || basename(directoryName) !== directoryName || /[\\/]/.test(directoryName)) {
    throw new TypeError('profile directory must be a direct child directory name')
  }
  if (['guest profile', 'system profile'].includes(directoryName.toLowerCase()) || directoryName.toLowerCase().includes('backup')) {
    throw new TypeError('guest, system, and backup profiles are not supported')
  }
  return directoryName
}

function normalizeStoredProfile(value: unknown): BrowserProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('stored browser profile must be an object')
  const raw = value as Record<string, unknown>
  return {
    id: uuid(raw.id, 'profile id'),
    browserDataDirectoryId: uuid(raw.browserDataDirectoryId, 'profile browserDataDirectoryId'),
    directoryName: validateProfileDirectoryName(raw.directoryName),
    name: text(raw.name, 'profile name', MAX_NAME, true),
    userIdentifier: text(raw.userIdentifier, 'profile user identifier', MAX_NAME, true),
    origin: oneOf(raw.origin, BROWSER_PROFILE_ORIGINS, 'profile origin'),
    createdAt: iso(raw.createdAt, 'profile createdAt'),
    updatedAt: iso(raw.updatedAt, 'profile updatedAt'),
  }
}

function normalizeStoredProfileV4(value: unknown): V4BrowserProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('stored browser profile must be an object')
  const raw = value as Record<string, unknown>
  return {
    id: uuid(raw.id, 'profile id'),
    browserDataDirectoryId: uuid(raw.browserDataDirectoryId, 'profile browserDataDirectoryId'),
    directoryName: validateProfileDirectoryName(raw.directoryName),
    name: text(raw.name, 'profile name', MAX_NAME, true),
    origin: oneOf(raw.origin, BROWSER_PROFILE_ORIGINS, 'profile origin'),
    createdAt: iso(raw.createdAt, 'profile createdAt'),
    updatedAt: iso(raw.updatedAt, 'profile updatedAt'),
  }
}

function normalizeStoredAccount(value: unknown): PlatformAccount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('stored account must be an object')
  const raw = value as Record<string, unknown>
  const base = normalizePlatformAccountInput(raw)
  const { browserProfileId: _unused, ...legacyBase } = base
  return {
    ...legacyBase,
    id: accountId(raw.id),
    browserDataDirectoryId: uuid(raw.browserDataDirectoryId, 'browserDataDirectoryId'),
    browserProfileId: uuid(raw.browserProfileId, 'browserProfileId'),
    loginState: oneOf(raw.loginState, LOGIN_STATES, 'loginState'),
    loginCheckState: oneOf(raw.loginCheckState ?? 'unchecked', LOGIN_CHECK_STATES, 'loginCheckState'),
    ...(raw.loginStatusSource ? { loginStatusSource: oneOf(raw.loginStatusSource, LOGIN_STATUS_SOURCES, 'loginStatusSource') } : {}),
    ...(raw.lastLoginCheckAt ? { lastLoginCheckAt: iso(raw.lastLoginCheckAt, 'lastLoginCheckAt') } : {}),
    ...(raw.lastLoginValidAt ? { lastLoginValidAt: iso(raw.lastLoginValidAt, 'lastLoginValidAt') } : {}),
    ...(raw.loginCheckMessage ? { loginCheckMessage: text(raw.loginCheckMessage, 'loginCheckMessage', 1000) } : {}),
    keepAlive: normalizeKeepAlive(raw.keepAlive),
    createdAt: iso(raw.createdAt, 'createdAt'),
    updatedAt: iso(raw.updatedAt, 'updatedAt'),
    ...(raw.lastOpenedAt ? { lastOpenedAt: iso(raw.lastOpenedAt, 'lastOpenedAt') } : {}),
    ...(raw.archivedAt ? { archivedAt: iso(raw.archivedAt, 'archivedAt') } : {}),
  }
}

function normalizeStoredAccountV4(value: unknown): V4PlatformAccount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('stored account must be an object')
  const raw = value as Record<string, unknown>
  const base = normalizePlatformAccountInput(raw)
  return {
    ...base,
    id: uuid(raw.id, 'account id'),
    accountLabel: text(raw.accountLabel, 'accountLabel', 160),
    browserDataDirectoryId: uuid(raw.browserDataDirectoryId, 'browserDataDirectoryId'),
    browserProfileId: uuid(raw.browserProfileId, 'browserProfileId'),
    loginState: oneOf(raw.loginState, LOGIN_STATES, 'loginState'),
    loginCheckState: oneOf(raw.loginCheckState ?? 'unchecked', LOGIN_CHECK_STATES, 'loginCheckState'),
    ...(raw.loginStatusSource ? { loginStatusSource: oneOf(raw.loginStatusSource, LOGIN_STATUS_SOURCES, 'loginStatusSource') } : {}),
    ...(raw.lastLoginCheckAt ? { lastLoginCheckAt: iso(raw.lastLoginCheckAt, 'lastLoginCheckAt') } : {}),
    ...(raw.lastLoginValidAt ? { lastLoginValidAt: iso(raw.lastLoginValidAt, 'lastLoginValidAt') } : {}),
    ...(raw.loginCheckMessage ? { loginCheckMessage: text(raw.loginCheckMessage, 'loginCheckMessage', 1000) } : {}),
    keepAlive: normalizeKeepAlive(raw.keepAlive),
    createdAt: iso(raw.createdAt, 'createdAt'),
    updatedAt: iso(raw.updatedAt, 'updatedAt'),
    ...(raw.lastOpenedAt ? { lastOpenedAt: iso(raw.lastOpenedAt, 'lastOpenedAt') } : {}),
    ...(raw.archivedAt ? { archivedAt: iso(raw.archivedAt, 'archivedAt') } : {}),
  }
}

function normalizeStoredAccountV3(value: unknown): V3PlatformAccount {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('stored platform account must be an object')
  const raw = value as Record<string, unknown>
  const base = normalizePlatformAccountInput(raw)
  const { browserProfileId: _unused, ...legacyBase } = base
  return {
    ...legacyBase,
    id: uuid(raw.id, 'account id'),
    accountLabel: text(raw.accountLabel, 'accountLabel', 160),
    browserDataDirectoryId: uuid(raw.browserDataDirectoryId, 'browserDataDirectoryId'),
    loginState: oneOf(raw.loginState, LOGIN_STATES, 'loginState'),
    loginCheckState: oneOf(raw.loginCheckState ?? 'unchecked', LOGIN_CHECK_STATES, 'loginCheckState'),
    ...(raw.loginStatusSource ? { loginStatusSource: oneOf(raw.loginStatusSource, LOGIN_STATUS_SOURCES, 'loginStatusSource') } : {}),
    ...(raw.lastLoginCheckAt ? { lastLoginCheckAt: iso(raw.lastLoginCheckAt, 'lastLoginCheckAt') } : {}),
    ...(raw.lastLoginValidAt ? { lastLoginValidAt: iso(raw.lastLoginValidAt, 'lastLoginValidAt') } : {}),
    ...(raw.loginCheckMessage ? { loginCheckMessage: text(raw.loginCheckMessage, 'loginCheckMessage', 1000) } : {}),
    keepAlive: normalizeKeepAlive(raw.keepAlive),
    createdAt: iso(raw.createdAt, 'createdAt'),
    updatedAt: iso(raw.updatedAt, 'updatedAt'),
    ...(raw.lastOpenedAt ? { lastOpenedAt: iso(raw.lastOpenedAt, 'lastOpenedAt') } : {}),
    ...(raw.archivedAt ? { archivedAt: iso(raw.archivedAt, 'archivedAt') } : {}),
  }
}

function validateDocumentCollections(
  browserDataDirectories: BrowserDataDirectory[],
  browserProfiles: Array<BrowserProfile | V4BrowserProfile>,
  accounts: Array<PlatformAccount | V4PlatformAccount>,
): void {
  if (new Set(browserDataDirectories.map(directory => directory.id)).size !== browserDataDirectories.length) {
    throw new TypeError('platform manager document contains duplicate directory ids')
  }
  if (new Set(accounts.map(account => account.id)).size !== accounts.length) {
    throw new TypeError('platform manager document contains duplicate account ids')
  }
  if (new Set(browserProfiles.map(profile => profile.id)).size !== browserProfiles.length) {
    throw new TypeError('platform manager document contains duplicate profile ids')
  }
  const directoryIds = new Set(browserDataDirectories.map(directory => directory.id))
  if (browserProfiles.some(profile => !directoryIds.has(profile.browserDataDirectoryId))) {
    throw new TypeError('platform manager document contains a profile with an unknown browser data directory')
  }
  const profileKeys = browserProfiles.map(profile => `${profile.browserDataDirectoryId}\u0000${profile.directoryName.toLowerCase()}`)
  if (new Set(profileKeys).size !== profileKeys.length) {
    throw new TypeError('platform manager document contains duplicate profile directories')
  }
  const profileMap = new Map(browserProfiles.map(profile => [profile.id, profile]))
  if (accounts.some(account => !directoryIds.has(account.browserDataDirectoryId))) {
    throw new TypeError('platform manager document contains an account with an unknown browser data directory')
  }
  if (accounts.some(account => profileMap.get(account.browserProfileId)?.browserDataDirectoryId !== account.browserDataDirectoryId)) {
    throw new TypeError('platform manager document contains an account with an unknown or mismatched browser profile')
  }
  for (let index = 0; index < browserDataDirectories.length; index += 1) {
    for (let other = index + 1; other < browserDataDirectories.length; other += 1) {
      if (isSameOrNested(browserDataDirectories[index].path, browserDataDirectories[other].path)) {
        throw new TypeError('browser data directory paths must be unique and cannot be nested')
      }
    }
  }
}

function parseV4(raw: Record<string, unknown>): V4AccountDocument {
  if (!Array.isArray(raw.browserDataDirectories) || !Array.isArray(raw.browserProfiles) || !Array.isArray(raw.accounts)) {
    throw new TypeError('platform manager document has invalid collections')
  }
  const browserDataDirectories = raw.browserDataDirectories.map(value => normalizeStoredDirectory(value))
  const browserProfiles = raw.browserProfiles.map(value => normalizeStoredProfileV4(value))
  const accounts = raw.accounts.map(normalizeStoredAccountV4)
  validateDocumentCollections(browserDataDirectories, browserProfiles, accounts)
  return { version: 4, browserDataDirectories, browserProfiles, accounts }
}

function parseV5(raw: Record<string, unknown>): AccountDocument {
  if (!Array.isArray(raw.browserDataDirectories) || !Array.isArray(raw.browserProfiles) || !Array.isArray(raw.accounts)) {
    throw new TypeError('platform manager document has invalid collections')
  }
  const nextAccountNumber = Number(raw.nextAccountNumber)
  if (!Number.isSafeInteger(nextAccountNumber) || nextAccountNumber < 1) {
    throw new TypeError('nextAccountNumber must be a positive integer')
  }
  const browserDataDirectories = raw.browserDataDirectories.map(value => normalizeStoredDirectory(value))
  const browserProfiles = raw.browserProfiles.map(value => normalizeStoredProfile(value))
  const accounts = raw.accounts.map(normalizeStoredAccount)
  validateDocumentCollections(browserDataDirectories, browserProfiles, accounts)
  const greatestAccountNumber = accounts.reduce((greatest, account) => Math.max(greatest, Number(account.id.slice(4))), 0)
  if (nextAccountNumber <= greatestAccountNumber) throw new TypeError('nextAccountNumber must exceed all allocated account ids')
  return { version: 5, nextAccountNumber, browserDataDirectories, browserProfiles, accounts }
}

function parseV3(raw: Record<string, unknown>): V3AccountDocument {
  if (!Array.isArray(raw.browserDataDirectories) || !Array.isArray(raw.accounts)) {
    throw new TypeError('platform manager document has invalid collections')
  }
  const browserDataDirectories = raw.browserDataDirectories.map(value => normalizeStoredDirectory(value))
  const accounts = raw.accounts.map(normalizeStoredAccountV3)
  return { version: 3, browserDataDirectories, accounts }
}

function inferDirectoryOrigin(
  raw: Record<string, unknown>,
  legacyProfilesDir: string,
  browserDataRoot: string,
): BrowserDataDirectoryOrigin {
  const id = uuid(raw.id, 'directory id')
  const path = validateBrowserDataPath(raw.path)
  if (normalizedPathKey(path) === normalizedPathKey(resolve(legacyProfilesDir, id))) return 'legacy'
  if (normalizedPathKey(path) === normalizedPathKey(resolve(browserDataRoot, id))) return 'plugin-created'
  return 'custom'
}

function migrateV2(document: V2AccountDocument, legacyProfilesDir: string, browserDataRoot: string): V3AccountDocument {
  const browserDataDirectories = document.browserDataDirectories.map(raw => normalizeStoredDirectory(
    raw,
    inferDirectoryOrigin(raw, legacyProfilesDir, browserDataRoot),
  ))
  const accounts = document.accounts.map(raw => {
    const account = normalizeStoredAccountV3(raw)
    if (account.loginCheckState === 'valid' || account.loginCheckState === 'invalid') {
      account.loginStatusSource = 'automatic'
    } else if (account.loginState === 'ready') {
      account.loginStatusSource = 'manual'
    }
    return account
  })
  return { version: 3, browserDataDirectories, accounts }
}

function legacyPlatformName(value: unknown): string {
  const key = typeof value === 'string' ? value : 'custom'
  const labels: Record<string, string> = {
    tmall: '天猫',
    taobao: '淘宝',
    '1688': '1688',
    alibaba: 'Alibaba.com',
    shopify: 'Shopify',
    custom: '自定义平台',
  }
  return labels[key] || key
}

function migrateV1(document: LegacyAccountDocument, legacyProfilesDir: string): V3AccountDocument {
  const browserDataDirectories: BrowserDataDirectory[] = []
  const accounts: V3PlatformAccount[] = []
  for (const raw of document.accounts) {
    const id = uuid(raw.id, 'account id')
    const now = iso(raw.updatedAt ?? raw.createdAt, 'updatedAt')
    const directory: BrowserDataDirectory = {
      id,
      name: `${text(raw.name, 'name', MAX_NAME, true)} 浏览器`,
      browser: oneOf(raw.browser ?? 'chrome', BROWSERS, 'browser'),
      path: resolve(legacyProfilesDir, id),
      managed: true,
      origin: 'legacy',
      createdAt: iso(raw.createdAt, 'createdAt'),
      updatedAt: now,
    }
    browserDataDirectories.push(directory)
    accounts.push({
      id,
      name: text(raw.name, 'name', MAX_NAME, true),
      platformName: legacyPlatformName(raw.platform),
      accountLabel: text(raw.accountLabel, 'accountLabel', 160),
      shopUrl: webUrl(raw.shopUrl, 'shopUrl'),
      loginUrl: webUrl(raw.loginUrl, 'loginUrl'),
      browserDataDirectoryId: id,
      agentInstructions: multilineText(raw.notes, 'notes', MAX_INSTRUCTIONS),
      loginState: oneOf(raw.loginState ?? 'pending', LOGIN_STATES, 'loginState'),
      loginCheckState: 'unchecked',
      ...(raw.loginState === 'ready' ? { loginStatusSource: 'manual' as const } : {}),
      keepAlive: defaultKeepAlive(),
      createdAt: iso(raw.createdAt, 'createdAt'),
      updatedAt: now,
      ...(raw.lastOpenedAt ? { lastOpenedAt: iso(raw.lastOpenedAt, 'lastOpenedAt') } : {}),
      ...(raw.archivedAt ? { archivedAt: iso(raw.archivedAt, 'archivedAt') } : {}),
    })
  }
  return { version: 3, browserDataDirectories, accounts }
}

async function lastUsedProfileDirectory(path: string): Promise<string | undefined> {
  try {
    const localState: unknown = JSON.parse(await readFile(join(path, 'Local State'), 'utf8'))
    if (typeof localState !== 'object' || localState === null || Array.isArray(localState)) return undefined
    const profile = (localState as Record<string, unknown>).profile
    if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return undefined
    const lastUsed = (profile as Record<string, unknown>).last_used
    return typeof lastUsed === 'string' ? lastUsed : undefined
  } catch {
    return undefined
  }
}

async function migrateV3ToV4(document: V3AccountDocument): Promise<V4AccountDocument> {
  const browserProfiles: V4BrowserProfile[] = []
  const profileByDirectory = new Map<string, V4BrowserProfile>()
  for (const directory of document.browserDataDirectories) {
    const discovered = await inspectBrowserDataDirectory(directory.browser, directory.path)
    const lastUsed = await lastUsedProfileDirectory(directory.path)
    const selected = (lastUsed ? discovered.find(profile => profile.directoryName === lastUsed) : undefined)
      || (discovered.length === 1 ? discovered[0] : undefined)
      || discovered.find(profile => profile.directoryName === 'Default')
      || { directoryName: 'Default', name: 'Default', accountCount: 0 }
    const now = new Date().toISOString()
    const profile: V4BrowserProfile = {
      id: randomUUID(),
      browserDataDirectoryId: directory.id,
      directoryName: selected.directoryName,
      name: selected.name,
      origin: directory.origin === 'plugin-created' ? 'plugin-created'
        : directory.origin === 'legacy' ? 'legacy' : 'discovered',
      createdAt: directory.createdAt || now,
      updatedAt: now,
    }
    browserProfiles.push(profile)
    profileByDirectory.set(directory.id, profile)
  }
  const accounts: V4PlatformAccount[] = document.accounts.map(account => {
    const profile = profileByDirectory.get(account.browserDataDirectoryId)
    if (!profile) throw new TypeError('could not migrate an account without a browser data directory profile')
    return { ...account, browserProfileId: profile.id }
  })
  validateDocumentCollections(document.browserDataDirectories, browserProfiles, accounts)
  return { version: 4, browserDataDirectories: document.browserDataDirectories, browserProfiles, accounts }
}

function formatAccountId(value: number): string {
  return `ACC-${String(value).padStart(4, '0')}`
}

function migrateV4ToV5(document: V4AccountDocument): AccountDocument {
  const orderedAccounts = [...document.accounts].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  ))
  const idMap = new Map(orderedAccounts.map((account, index) => [account.id, formatAccountId(index + 1)]))
  const browserProfiles: BrowserProfile[] = document.browserProfiles.map(profile => ({
    ...profile,
    userIdentifier: profile.name,
  }))
  const accounts: PlatformAccount[] = document.accounts.map(account => {
    const { accountLabel: _unused, id, ...rest } = account
    return { ...rest, id: idMap.get(id)! }
  })
  validateDocumentCollections(document.browserDataDirectories, browserProfiles, accounts)
  return {
    version: 5,
    nextAccountNumber: accounts.length + 1,
    browserDataDirectories: document.browserDataDirectories,
    browserProfiles,
    accounts,
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export class AccountRepository {
  readonly filename: string
  readonly runtimeFilename: string
  readonly legacyProfilesDir: string
  private queue: Promise<void> = Promise.resolve()

  constructor(readonly dataDir: string, readonly browserDataRoot: string = join(dataDir, 'browser-data')) {
    this.filename = join(dataDir, 'accounts.json')
    this.runtimeFilename = join(dataDir, 'browser-runtime.json')
    this.legacyProfilesDir = join(dataDir, 'profiles')
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
    await mkdir(this.browserDataRoot, { recursive: true, mode: 0o700 })
    let source: string
    try {
      source = await readFile(this.filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.write({ version: 5, nextAccountNumber: 1, browserDataDirectories: [], browserProfiles: [], accounts: [] })
      return
    }
    const raw = JSON.parse(source) as Record<string, unknown>
    let legacyDocument: V3AccountDocument | undefined
    if (raw.version === 1) {
      legacyDocument = migrateV1(raw as unknown as LegacyAccountDocument, this.legacyProfilesDir)
      await writeFile(join(this.dataDir, 'accounts.v1.backup.json'), source, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        .catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        })
    } else if (raw.version === 2) {
      legacyDocument = migrateV2(raw as unknown as V2AccountDocument, this.legacyProfilesDir, this.browserDataRoot)
      await writeFile(join(this.dataDir, 'accounts.v2.backup.json'), source, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        .catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        })
    } else if (raw.version === 3) {
      legacyDocument = parseV3(raw)
      await writeFile(join(this.dataDir, 'accounts.v3.backup.json'), source, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        .catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        })
    } else if (raw.version === 4) {
      await writeFile(join(this.dataDir, 'accounts.v4.backup.json'), source, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        .catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        })
    } else if (raw.version !== 5) {
      throw new TypeError('unsupported platform manager document version')
    }
    const v4 = legacyDocument ? await migrateV3ToV4(legacyDocument) : raw.version === 4 ? parseV4(raw) : undefined
    const document = v4 ? migrateV4ToV5(v4) : parseV5(raw)
    for (const directory of document.browserDataDirectories.filter(candidate => candidate.origin === 'plugin-created')) {
      await this.ensureManagedMarker(directory, true)
    }
    if (raw.version !== 5) await this.write(document)
  }

  async list(options: { archived?: boolean } = {}): Promise<PlatformAccount[]> {
    const document = await this.read()
    return document.accounts
      .filter(account => options.archived ? Boolean(account.archivedAt) : !account.archivedAt)
      .map(account => structuredClone(account))
  }

  async get(id: string, includeArchived = false): Promise<PlatformAccount> {
    const document = await this.read()
    const account = document.accounts.find(candidate => candidate.id === id)
    if (!account || (!includeArchived && account.archivedAt)) throw new Error(`unknown platform account: ${id}`)
    return structuredClone(account)
  }

  async listDirectories(options: { archived?: boolean } = {}): Promise<BrowserDataDirectory[]> {
    return (await this.read()).browserDataDirectories
      .filter(directory => options.archived ? Boolean(directory.archivedAt) : !directory.archivedAt)
      .map(directory => ({ ...directory }))
  }

  async listProfiles(): Promise<BrowserProfile[]> {
    return (await this.read()).browserProfiles.map(profile => ({ ...profile }))
  }

  async getProfile(id: string): Promise<BrowserProfile> {
    const profile = (await this.read()).browserProfiles.find(candidate => candidate.id === id)
    if (!profile) throw new Error(`unknown browser profile: ${id}`)
    return { ...profile }
  }

  async renameProfile(id: string, userIdentifier: unknown): Promise<BrowserProfile> {
    const normalized = text(userIdentifier, 'profile user identifier', MAX_NAME, true)
    return await this.mutate(document => {
      const profile = document.browserProfiles.find(candidate => candidate.id === id)
      if (!profile) throw new Error(`unknown browser profile: ${id}`)
      profile.userIdentifier = normalized
      profile.updatedAt = new Date().toISOString()
      return { ...profile }
    })
  }

  async getDirectory(id: string, includeArchived = false): Promise<BrowserDataDirectory> {
    const directory = (await this.read()).browserDataDirectories.find(candidate => candidate.id === id)
    if (!directory || (!includeArchived && directory.archivedAt)) throw new Error(`unknown browser data directory: ${id}`)
    return { ...directory }
  }

  async directoryForAccount(account: PlatformAccount): Promise<BrowserDataDirectory> {
    return await this.getDirectory(account.browserDataDirectoryId)
  }

  async profileForAccount(account: PlatformAccount): Promise<BrowserProfile> {
    const profile = await this.getProfile(account.browserProfileId)
    if (profile.browserDataDirectoryId !== account.browserDataDirectoryId) {
      throw new TypeError('platform account browser profile does not belong to its browser data directory')
    }
    return profile
  }

  async accountsForDirectory(directoryId: string): Promise<PlatformAccount[]> {
    return (await this.list()).filter(account => account.browserDataDirectoryId === directoryId)
  }

  async accountsForProfile(profileId: string): Promise<PlatformAccount[]> {
    return (await this.list()).filter(account => account.browserProfileId === profileId)
  }

  async create(value: unknown, selection: unknown): Promise<PlatformAccount> {
    const input = normalizePlatformAccountInput(value)
    const directorySelection = this.normalizeSelection(selection)
    return await this.mutate(async document => {
      assertUniqueActiveAccount(document, input)
      const id = this.allocateAccountId(document)
      let directory: BrowserDataDirectory
      let profile: BrowserProfile
      if (directorySelection.mode === 'existing') {
        const found = document.browserDataDirectories.find(candidate => candidate.id === directorySelection.id && !candidate.archivedAt)
        if (!found) throw new Error(`unknown browser data directory: ${directorySelection.id}`)
        directory = found
        profile = await this.ensureProfileRecord(
          document,
          directory,
          directorySelection.profileDirectory,
          directorySelection.profileName,
          directorySelection.profileUserIdentifier,
          'discovered',
        )
      } else if (directorySelection.mode === 'discovered') {
        directory = await this.ensureDiscoveredDirectoryRecord(document, directorySelection, input.name)
        profile = await this.ensureProfileRecord(
          document,
          directory,
          directorySelection.profileDirectory,
          directorySelection.profileName,
          directorySelection.profileUserIdentifier,
          'discovered',
        )
      } else {
        directory = await this.createDirectoryRecord(document, input.name, id, directorySelection.directory)
        document.browserDataDirectories.push(directory)
        profile = await this.ensureProfileRecord(
          document,
          directory,
          'Default',
          'Default',
          directorySelection.directory?.profileUserIdentifier || input.name,
          'plugin-created',
          true,
        )
      }
      const now = new Date().toISOString()
      const account: PlatformAccount = {
        id,
        ...input,
        browserDataDirectoryId: directory.id,
        browserProfileId: profile.id,
        loginState: 'pending',
        loginCheckState: 'unchecked',
        keepAlive: defaultKeepAlive(),
        createdAt: now,
        updatedAt: now,
      }
      document.accounts.push(account)
      return structuredClone(account)
    })
  }

  async update(id: string, value: unknown): Promise<PlatformAccount> {
    const input = normalizePlatformAccountInput(value)
    return await this.mutate(document => {
      const index = document.accounts.findIndex(account => account.id === id && !account.archivedAt)
      if (index < 0) throw new Error(`unknown platform account: ${id}`)
      const previous = document.accounts[index]
      if (input.browserDataDirectoryId && input.browserDataDirectoryId !== previous.browserDataDirectoryId) {
        throw new TypeError('moving an account to another browser data directory is not supported')
      }
      if (input.browserProfileId && input.browserProfileId !== previous.browserProfileId) {
        throw new TypeError('moving an account to another browser profile is not supported')
      }
      const directoryId = previous.browserDataDirectoryId
      const profileId = previous.browserProfileId
      assertUniqueActiveAccount(document, input, id)
      const updated: PlatformAccount = {
        ...previous,
        ...input,
        browserDataDirectoryId: directoryId,
        browserProfileId: profileId,
        updatedAt: new Date().toISOString(),
      }
      document.accounts[index] = updated
      return structuredClone(updated)
    })
  }

  async manualConfirmLogin(id: string): Promise<PlatformAccount> {
    return await this.updateAccount(id, account => {
      const confirmedAt = new Date().toISOString()
      account.loginState = 'ready'
      account.loginStatusSource = 'manual'
      account.loginCheckState = 'unchecked'
      account.lastLoginValidAt = confirmedAt
      delete account.lastLoginCheckAt
      delete account.loginCheckMessage
    })
  }

  async recordLoginCheck(id: string, result: LoginCheckResult): Promise<PlatformAccount> {
    return await this.updateAccount(id, account => {
      account.loginCheckState = result.state
      account.lastLoginCheckAt = result.checkedAt
      account.loginCheckMessage = result.message
      if (result.state === 'valid') {
        account.loginState = 'ready'
        account.loginStatusSource = 'automatic'
        account.lastLoginValidAt = result.checkedAt
      } else if (result.state === 'invalid') {
        account.loginState = 'attention'
        account.loginStatusSource = 'automatic'
      }
    })
  }

  async setKeepAlive(id: string, value: unknown): Promise<PlatformAccount> {
    return await this.updateAccount(id, account => {
      const keepAlive = normalizeKeepAlive(value, account.keepAlive)
      keepAlive.consecutiveFailures = 0
      if (keepAlive.enabled) keepAlive.nextRunAt = nextKeepAliveAt(keepAlive)
      else delete keepAlive.nextRunAt
      account.keepAlive = keepAlive
    })
  }

  async recordKeepAliveRun(id: string, result: KeepAliveResult, message: string, at = new Date()): Promise<PlatformAccount> {
    return await this.updateAccount(id, account => {
      const failed = result === 'error'
      account.keepAlive.lastRunAt = at.toISOString()
      account.keepAlive.lastResult = result
      account.keepAlive.lastMessage = text(message, 'keep alive message', 1000)
      account.keepAlive.consecutiveFailures = failed ? account.keepAlive.consecutiveFailures + 1 : 0
      if (account.keepAlive.enabled) {
        const multiplier = failed ? Math.min(2 ** account.keepAlive.consecutiveFailures, 8) : 1
        account.keepAlive.nextRunAt = nextKeepAliveAt(account.keepAlive, at, Math.random, multiplier)
      } else {
        delete account.keepAlive.nextRunAt
      }
    })
  }

  async dueKeepAliveAccounts(now = new Date()): Promise<PlatformAccount[]> {
    return (await this.list()).filter(account => account.keepAlive.enabled && account.keepAlive.nextRunAt && Date.parse(account.keepAlive.nextRunAt) <= now.getTime())
  }

  async markOpened(id: string): Promise<PlatformAccount> {
    return await this.updateAccount(id, account => {
      account.lastOpenedAt = new Date().toISOString()
    })
  }

  async archive(id: string): Promise<PlatformAccount> {
    return await this.updateAccount(id, account => {
      account.archivedAt = new Date().toISOString()
    })
  }

  async restore(id: string): Promise<PlatformAccount> {
    return await this.mutate(document => {
      const account = document.accounts.find(candidate => candidate.id === id && candidate.archivedAt)
      if (!account) throw new Error(`unknown archived platform account: ${id}`)
      const directory = document.browserDataDirectories.find(candidate => candidate.id === account.browserDataDirectoryId)
      if (!directory || directory.archivedAt) throw new TypeError('restore the browser data directory before restoring this account')
      const profile = document.browserProfiles.find(candidate => candidate.id === account.browserProfileId)
      if (!profile || profile.browserDataDirectoryId !== directory.id) throw new TypeError('restore requires the account browser profile')
      assertUniqueActiveAccount(document, account, id)
      delete account.archivedAt
      account.updatedAt = new Date().toISOString()
      return structuredClone(account)
    })
  }

  async remove(id: string): Promise<{ account: PlatformAccount, orphanedDirectoryId?: string }> {
    return await this.mutate(document => {
      const index = document.accounts.findIndex(account => account.id === id)
      if (index < 0) throw new Error(`unknown platform account: ${id}`)
      const [account] = document.accounts.splice(index, 1)
      const orphaned = !document.accounts.some(candidate => candidate.browserDataDirectoryId === account.browserDataDirectoryId)
      return { account: structuredClone(account), ...(orphaned ? { orphanedDirectoryId: account.browserDataDirectoryId } : {}) }
    })
  }

  async renameDirectory(id: string, nameValue: unknown): Promise<BrowserDataDirectory> {
    const name = text(nameValue, 'directory name', MAX_NAME, true)
    return await this.mutate(document => {
      const directory = document.browserDataDirectories.find(candidate => candidate.id === id)
      if (!directory) throw new Error(`unknown browser data directory: ${id}`)
      directory.name = name
      directory.updatedAt = new Date().toISOString()
      return { ...directory }
    })
  }

  async archiveDirectory(id: string, context: DirectoryMutationContext): Promise<BrowserDataDirectory> {
    if (context.online) throw new TypeError('close the browser before archiving its data directory')
    return await this.mutate(document => {
      const directory = document.browserDataDirectories.find(candidate => candidate.id === id && !candidate.archivedAt)
      if (!directory) throw new Error(`unknown browser data directory: ${id}`)
      if (document.accounts.some(account => !account.archivedAt && account.browserDataDirectoryId === id)) {
        throw new TypeError('archive all active accounts in this browser data directory first')
      }
      const now = new Date().toISOString()
      directory.archivedAt = now
      directory.updatedAt = now
      return { ...directory }
    })
  }

  async restoreDirectory(id: string): Promise<BrowserDataDirectory> {
    return await this.mutate(document => {
      const directory = document.browserDataDirectories.find(candidate => candidate.id === id && candidate.archivedAt)
      if (!directory) throw new Error(`unknown archived browser data directory: ${id}`)
      delete directory.archivedAt
      directory.updatedAt = new Date().toISOString()
      return { ...directory }
    })
  }

  async deleteDirectory(id: string, options: DeleteDirectoryOptions): Promise<{
    directory: BrowserDataDirectory
    removedArchivedAccounts: PlatformAccount[]
    deletedLocalData: boolean
  }> {
    if (options.online) throw new TypeError('close the browser before deleting its data directory')
    return await this.mutate(async document => {
      const index = document.browserDataDirectories.findIndex(candidate => candidate.id === id && candidate.archivedAt)
      if (index < 0) throw new TypeError('browser data directory must be archived before deletion')
      const directory = document.browserDataDirectories[index]
      if (document.accounts.some(account => !account.archivedAt && account.browserDataDirectoryId === id)) {
        throw new TypeError('active accounts still reference this browser data directory')
      }
      if (options.deleteLocalData) {
        if (text(options.confirmationName, 'confirmation name', MAX_NAME, true) !== directory.name) {
          throw new TypeError('confirmation name does not match the browser data directory name')
        }
        await this.deleteOwnedLocalDirectory(directory)
      }
      const removedArchivedAccounts = document.accounts.filter(account => account.archivedAt && account.browserDataDirectoryId === id)
      document.accounts = document.accounts.filter(account => account.browserDataDirectoryId !== id)
      document.browserProfiles = document.browserProfiles.filter(profile => profile.browserDataDirectoryId !== id)
      document.browserDataDirectories.splice(index, 1)
      return {
        directory: { ...directory },
        removedArchivedAccounts: structuredClone(removedArchivedAccounts),
        deletedLocalData: options.deleteLocalData,
      }
    })
  }

  private normalizeSelection(value: unknown): BrowserDirectorySelection {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('directory selection is required')
    const raw = value as Record<string, unknown>
    if (raw.mode === 'existing') return {
      mode: 'existing',
      id: uuid(raw.id, 'directory id'),
      profileDirectory: validateProfileDirectoryName(raw.profileDirectory),
      ...(raw.profileName ? { profileName: text(raw.profileName, 'profile name', MAX_NAME) } : {}),
      ...(raw.profileUserIdentifier ? { profileUserIdentifier: text(raw.profileUserIdentifier, 'profile user identifier', MAX_NAME, true) } : {}),
    }
    if (raw.mode === 'discovered') return {
      mode: 'discovered',
      browser: oneOf(raw.browser, BROWSERS, 'browser'),
      path: validateBrowserDataPath(raw.path),
      ...(raw.name ? { name: text(raw.name, 'directory name', MAX_NAME) } : {}),
      profileDirectory: validateProfileDirectoryName(raw.profileDirectory),
      ...(raw.profileName ? { profileName: text(raw.profileName, 'profile name', MAX_NAME) } : {}),
      ...(raw.profileUserIdentifier ? { profileUserIdentifier: text(raw.profileUserIdentifier, 'profile user identifier', MAX_NAME, true) } : {}),
    }
    if (raw.mode !== 'new') throw new TypeError('directory selection mode must be existing, discovered, or new')
    if (raw.directory !== undefined && (typeof raw.directory !== 'object' || raw.directory === null || Array.isArray(raw.directory))) {
      throw new TypeError('new browser data directory must be an object')
    }
    const directory = (raw.directory || {}) as Record<string, unknown>
    return {
      mode: 'new',
      directory: {
        ...(directory.name ? { name: text(directory.name, 'directory name', MAX_NAME) } : {}),
        ...(directory.browser ? { browser: oneOf(directory.browser, BROWSERS, 'browser') } : {}),
        ...(directory.path ? { path: validateBrowserDataPath(directory.path) } : {}),
        ...(directory.profileUserIdentifier
          ? { profileUserIdentifier: text(directory.profileUserIdentifier, 'profile user identifier', MAX_NAME, true) }
          : {}),
      },
    }
  }

  private allocateAccountId(document: AccountDocument): string {
    let candidate: string
    do {
      candidate = formatAccountId(document.nextAccountNumber)
      document.nextAccountNumber += 1
    } while (document.accounts.some(account => account.id === candidate))
    return candidate
  }

  private async ensureDiscoveredDirectoryRecord(
    document: AccountDocument,
    selection: Extract<BrowserDirectorySelection, { mode: 'discovered' }>,
    accountName: string,
  ): Promise<BrowserDataDirectory> {
    const path = validateBrowserDataPath(selection.path)
    const exact = document.browserDataDirectories.find(directory => normalizedPathKey(directory.path) === normalizedPathKey(path))
    if (exact) {
      if (exact.archivedAt) throw new TypeError('restore the registered browser data directory before using it')
      if (exact.browser !== selection.browser) throw new TypeError('the browser type does not match the registered data directory')
      return exact
    }
    if (document.browserDataDirectories.some(directory => isSameOrNested(directory.path, path))) {
      throw new TypeError('browser data directory overlaps another registered directory')
    }
    if (!await pathExists(join(path, 'Local State'))) {
      throw new TypeError('the selected browser data directory does not contain Local State')
    }
    const now = new Date().toISOString()
    const directory: BrowserDataDirectory = {
      id: randomUUID(),
      name: selection.name || `${accountName} 浏览器`,
      browser: selection.browser,
      path,
      managed: false,
      origin: 'custom',
      createdAt: now,
      updatedAt: now,
    }
    document.browserDataDirectories.push(directory)
    return directory
  }

  private async ensureProfileRecord(
    document: AccountDocument,
    directory: BrowserDataDirectory,
    directoryNameValue: unknown,
    nameValue: unknown,
    userIdentifierValue: unknown,
    origin: BrowserProfileOrigin,
    allowMissing = false,
  ): Promise<BrowserProfile> {
    const directoryName = validateProfileDirectoryName(directoryNameValue)
    const existing = document.browserProfiles.find(profile => profile.browserDataDirectoryId === directory.id
      && profile.directoryName.toLowerCase() === directoryName.toLowerCase())
    if (existing) {
      const userIdentifier = userIdentifierValue
        ? text(userIdentifierValue, 'profile user identifier', MAX_NAME, true)
        : existing.userIdentifier
      if (userIdentifier !== existing.userIdentifier) {
        existing.userIdentifier = userIdentifier
        existing.updatedAt = new Date().toISOString()
      }
      return existing
    }
    const preferencesPath = join(directory.path, directoryName, 'Preferences')
    if (!allowMissing && !await pathExists(preferencesPath)) {
      throw new TypeError('the selected browser profile does not contain Preferences')
    }
    const now = new Date().toISOString()
    const profile: BrowserProfile = {
      id: randomUUID(),
      browserDataDirectoryId: directory.id,
      directoryName,
      name: text(nameValue || directoryName, 'profile name', MAX_NAME, true),
      userIdentifier: text(userIdentifierValue || nameValue || directoryName, 'profile user identifier', MAX_NAME, true),
      origin,
      createdAt: now,
      updatedAt: now,
    }
    document.browserProfiles.push(profile)
    return profile
  }

  private async createDirectoryRecord(
    document: AccountDocument,
    accountName: string,
    accountId: string,
    value: NewBrowserDataDirectoryInput | undefined,
  ): Promise<BrowserDataDirectory> {
    const id = randomUUID()
    const browser = (value?.browser || 'chrome') as BrowserKind
    const path = value?.path ? validateBrowserDataPath(value.path) : resolve(this.browserDataRoot, accountId)
    if (document.browserDataDirectories.some(directory => isSameOrNested(directory.path, path))) {
      throw new TypeError('browser data directory is already registered or overlaps another managed directory')
    }
    const now = new Date().toISOString()
    const directory: BrowserDataDirectory = {
      id,
      name: value?.name || `${accountName} 浏览器`,
      browser,
      path,
      managed: true,
      origin: value?.path ? 'custom' : 'plugin-created',
      createdAt: now,
      updatedAt: now,
    }
    await this.ensureManagedMarker(directory, false)
    return directory
  }

  private async ensureManagedMarker(directory: BrowserDataDirectory, allowExistingContent: boolean): Promise<void> {
    const exists = await pathExists(directory.path)
    if (!exists) await mkdir(directory.path, { recursive: true, mode: 0o700 })
    const entries = await readdir(directory.path)
    const markerPath = join(directory.path, MARKER_FILENAME)
    if (!allowExistingContent && entries.some(entry => entry !== MARKER_FILENAME)) {
      throw new TypeError('custom browser data directory must be empty')
    }
    if (entries.includes(MARKER_FILENAME)) {
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { id?: unknown, browser?: unknown }
      if (marker.id !== directory.id || marker.browser !== directory.browser) {
        throw new TypeError('browser data directory is managed by another record')
      }
      return
    }
    await writeFile(markerPath, `${JSON.stringify({
      version: 1,
      id: directory.id,
      browser: directory.browser,
      createdAt: directory.createdAt,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  }

  private async deleteOwnedLocalDirectory(directory: BrowserDataDirectory): Promise<void> {
    if (directory.origin !== 'plugin-created') {
      throw new TypeError('only plugin-created default browser data directories can be deleted from disk')
    }
    const expectedParent = resolve(this.browserDataRoot)
    if (normalizedPathKey(dirname(directory.path)) !== normalizedPathKey(expectedParent)) {
      throw new TypeError('browser data directory is outside the plugin-managed default root')
    }
    const stats = await lstat(directory.path)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new TypeError('browser data directory ownership could not be verified')
    }
    const [rootRealPath, directoryRealPath] = await Promise.all([
      realpath(this.browserDataRoot),
      realpath(directory.path),
    ])
    if (normalizedPathKey(directoryRealPath) !== normalizedPathKey(resolve(rootRealPath, basename(directory.path)))) {
      throw new TypeError('browser data directory resolves outside the plugin-managed default root')
    }
    const marker = JSON.parse(await readFile(join(directory.path, MARKER_FILENAME), 'utf8')) as Record<string, unknown>
    if (marker.version !== 1 || marker.id !== directory.id || marker.browser !== directory.browser || marker.createdAt !== directory.createdAt) {
      throw new TypeError('browser data directory ownership marker does not match this record')
    }
    await rm(directory.path, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 })
  }

  private async updateAccount(
    id: string,
    operation: (account: PlatformAccount) => void,
    includeArchived = false,
  ): Promise<PlatformAccount> {
    return await this.mutate(document => {
      const account = document.accounts.find(candidate => candidate.id === id && (includeArchived || !candidate.archivedAt))
      if (!account) throw new Error(`unknown platform account: ${id}`)
      operation(account)
      account.updatedAt = new Date().toISOString()
      return structuredClone(account)
    })
  }

  private async read(): Promise<AccountDocument> {
    const source = await readFile(this.filename, 'utf8')
    const raw = JSON.parse(source) as Record<string, unknown>
    if (raw.version !== 5) throw new TypeError('unsupported platform manager document version')
    return parseV5(raw)
  }

  private async write(document: AccountDocument): Promise<void> {
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    const temporary = `${this.filename}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.filename)
  }

  private async mutate<T>(operation: (document: AccountDocument) => T | Promise<T>): Promise<T> {
    let resolveResult!: (value: T) => void
    let rejectResult!: (reason: unknown) => void
    const result = new Promise<T>((resolveResultPromise, rejectResultPromise) => {
      resolveResult = resolveResultPromise
      rejectResult = rejectResultPromise
    })
    this.queue = this.queue.then(async () => {
      try {
        const document = await this.read()
        const value = await operation(document)
        await this.write(document)
        resolveResult(value)
      } catch (error) {
        rejectResult(error)
      }
    })
    return await result
  }
}

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  Archive,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Info,
  LoaderCircle,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  browserLabel,
  type BrowserKind,
  type BrowserDirectorySelection,
  type DiscoveredBrowserDataDirectory,
  type KeepAliveSettings,
  type LoginCheckResult,
  type PlatformAccountInput,
  type PublicBrowserDataDirectory,
  type PublicPlatformAccount,
} from '../shared.js'
import { styles } from './styles.js'

const NS = 'platformManagement'
const STYLE_ID = 'dsh-platform-account-manager-plugin/styles-v5'
const API_URL = '/platform-account-manager/api/accounts'

interface DirectorySnapshot {
  loading: boolean
  accounts: PublicPlatformAccount[]
  archivedAccounts: PublicPlatformAccount[]
  directories: PublicBrowserDataDirectory[]
  archivedDirectories: PublicBrowserDataDirectory[]
  availableDirectories: DiscoveredBrowserDataDirectory[]
  busyKeys: readonly string[]
  error?: string
}

interface ApiResponse<T = unknown> {
  ok: boolean
  state?: Pick<DirectorySnapshot, 'accounts' | 'archivedAccounts' | 'directories' | 'archivedDirectories' | 'availableDirectories'>
  result?: T
  error?: string
}

type Translate = (key: keyof typeof zh, params?: Record<string, unknown>) => string
type DirectoryHook = <T>(selector: (snapshot: DirectorySnapshot) => T) => T

interface ManagerProps {
  t: Translate
  close: () => void
  useDirectory: DirectoryHook
  refresh: () => Promise<void>
  createAccount: (account: PlatformAccountInput, directory: BrowserDirectorySelection) => Promise<unknown>
  updateAccount: (id: string, account: PlatformAccountInput) => Promise<unknown>
  archiveAccount: (id: string) => Promise<unknown>
  restoreAccount: (id: string) => Promise<unknown>
  deleteAccount: (id: string) => Promise<unknown>
  openAccount: (id: string) => Promise<unknown>
  closeBrowser: (id: string) => Promise<unknown>
  checkLogin: (id: string) => Promise<LoginCheckResult | undefined>
  manualConfirmLogin: (id: string) => Promise<unknown>
  setKeepAlive: (id: string, keepAlive: Partial<KeepAliveSettings>) => Promise<unknown>
  runKeepAlive: (id: string) => Promise<unknown>
  syncCookies: (profileId: string) => Promise<unknown>
  pickDirectory: () => Promise<string | null>
  inspectDirectory: (browser: BrowserKind, path: string) => Promise<DiscoveredBrowserDataDirectory | undefined>
  scanComputer: () => Promise<unknown>
  revealDirectory: (directoryId: string) => Promise<unknown>
  renameDirectory: (directoryId: string, name: string) => Promise<unknown>
  renameProfile: (profileId: string, userIdentifier: string) => Promise<unknown>
  archiveDirectory: (directoryId: string) => Promise<unknown>
  restoreDirectory: (directoryId: string) => Promise<unknown>
  deleteDirectory: (directoryId: string, deleteLocalData: boolean, confirmationName?: string) => Promise<unknown>
}

class PlatformDirectory {
  private snapshot: DirectorySnapshot = {
    loading: true,
    accounts: [],
    archivedAccounts: [],
    directories: [],
    archivedDirectories: [],
    availableDirectories: [],
    busyKeys: [],
  }
  private listeners = new Set<() => void>()
  private busy = new Set<string>()
  private disposed = false
  private refreshing = false

  readonly source = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener: () => void) => {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
  }

  constructor() {
    void this.refresh()
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  async refresh(): Promise<void> {
    if (this.refreshing || this.busy.size) return
    this.refreshing = true
    if (!this.snapshot.accounts.length && !this.snapshot.archivedAccounts.length) {
      this.publish({ ...this.snapshot, loading: true, error: undefined })
    }
    try {
      const data = await this.request()
      this.acceptState(data)
    } catch (error) {
      this.publish({ ...this.snapshot, loading: false, error: messageOf(error) })
    } finally {
      this.refreshing = false
    }
  }

  async mutate<T = unknown>(busyKey: string, action: string, payload: Record<string, unknown> = {}): Promise<T | undefined> {
    this.busy.add(busyKey)
    this.publish({ ...this.snapshot, busyKeys: [...this.busy], error: undefined })
    try {
      const data = await this.request<T>({ action, ...payload })
      this.acceptState(data)
      return data.result
    } catch (error) {
      this.publish({ ...this.snapshot, error: messageOf(error) })
      throw error
    } finally {
      this.busy.delete(busyKey)
      this.publish({ ...this.snapshot, busyKeys: [...this.busy] })
    }
  }

  private async request<T = unknown>(body?: Record<string, unknown>): Promise<ApiResponse<T>> {
    const response = await fetch(API_URL, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    } : { headers: { Accept: 'application/json' } })
    const data = await response.json() as ApiResponse<T>
    if (!response.ok || !data.ok || !data.state) throw new Error(data.error || `Request failed: ${response.status}`)
    return data
  }

  private acceptState(data: ApiResponse): void {
    if (!data.state) return
    this.publish({
      loading: false,
      accounts: data.state.accounts || [],
      archivedAccounts: data.state.archivedAccounts || [],
      directories: data.state.directories || [],
      archivedDirectories: data.state.archivedDirectories || [],
      availableDirectories: data.state.availableDirectories || [],
      busyKeys: [...this.busy],
    })
  }

  private publish(snapshot: DirectorySnapshot): void {
    if (this.disposed) return
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

const zh = {
  nav: '平台管理',
  title: '平台管理',
  subtitle: '统一管理平台账号、浏览器数据根目录、用户配置与登录状态',
  add: '新增账号',
  refresh: '刷新状态',
  summary: '{accounts} 个账号 · {directories} 个浏览器数据目录',
  privacy: '账号密码不会被插件保存；Cookie、站点存储和浏览器配置仅保留在所选本机目录。',
  emptyTitle: '还没有平台账号',
  emptyBody: '新增账号并选择浏览器数据根目录和用户配置。',
  directory: '浏览器数据根目录与用户配置',
  newDirectory: '新建数据根目录',
  existingDirectory: '复用已有数据根目录',
  directoryName: '目录名称',
  directoryPath: '自定义目录地址（可选）',
  chooseDirectory: '选择目录',
  copyPath: '复制目录地址',
  copied: '已复制',
  revealDirectory: '打开目录',
  syncCookies: '立即同步 Cookie',
  closeBrowser: '关闭浏览器',
  closeSharedConfirm: '这个浏览器数据目录由 {count} 个账号共享。关闭后，这些账号的页面都会关闭，是否继续？',
  online: '在线',
  offline: '离线',
  pages: '{count} 个页面',
  cookieIdle: 'Cookie 未同步',
  cookieOk: 'Cookie 已同步',
  cookieError: 'Cookie 同步失败',
  accountCount: '{count} 个账号',
  activeAccountCount: '{count} 个活动账号',
  archivedAccountCount: '{count} 个归档账号',
  createTitle: '新增平台账号',
  editTitle: '编辑平台账号',
  platformName: '平台名称',
  platformPlaceholder: '例如：淘宝、飞书、Shopify',
  accountName: '账号名称',
  accountNamePlaceholder: '用于区分这个账号',
  profileUserIdentifier: '用户标识',
  profileUserIdentifierPlaceholder: '例如：运营小王、店铺 A 专用',
  backendUrl: '平台后台地址',
  loginUrl: '登录地址',
  urlRequired: '后台地址和登录地址至少填写一个。',
  agentInstructions: 'Agent 操作说明（可选）',
  agentPlaceholder: '提供账号用途、业务范围等上下文，不作为权限控制。',
  browser: '浏览器',
  selectDirectory: '选择已有数据目录',
  selectProfile: '浏览器用户配置（Profile）',
  profile: '用户配置',
  inspectDirectory: '检查其他数据目录',
  scanComputer: '扫描整台电脑',
  searchAccounts: '搜索账号 ID、平台、账号名称或用户标识',
  noSearchResults: '没有匹配的平台账号',
  noProfiles: '该数据目录没有可用的用户配置。',
  profileInUse: '该用户配置已绑定 {count} 个平台账号。它们会共享 Cookie 和站点存储。',
  sameSiteProfileRisk: '同一用户配置中已有相同站点的账号，继续复用可能发生登录身份互相覆盖。',
  activeProfile: '当前在线：{name}',
  create: '创建账号',
  save: '保存',
  cancel: '取消',
  close: '关闭',
  openPlatform: '打开平台',
  checkLogin: '检测登录状态',
  confirmLogin: '人工标记为已登录',
  loginCheckTitle: '登录状态检测结果',
  automaticCheck: '自动检测',
  edit: '编辑账号',
  archive: '归档账号',
  archiveConfirm: '归档“{name}”？浏览器数据目录及登录数据会保留在本机。',
  loginValid: '登录有效',
  loginInvalid: '登录失效',
  loginUnknown: '无法判断',
  loginError: '检测失败',
  loginUnchecked: '尚未检测',
  manuallyReady: '人工确认',
  platformOpen: '页面已打开',
  browserOnline: '浏览器在线',
  browserOffline: '浏览器离线',
  keepAlive: '定时保活',
  keepAliveOn: '保活已启用',
  keepAliveOff: '保活未启用',
  keepAliveTitle: '登录会话保活',
  enabled: '启用定时保活',
  intervalHours: '间隔（小时）',
  jitterMinutes: '随机延迟（分钟）',
  activeStart: '允许开始时间',
  activeEnd: '允许结束时间',
  closeAfterRun: '完成后关闭本次临时启动的浏览器',
  nextRun: '下次运行',
  lastRun: '上次运行',
  never: '暂无',
  runNow: '立即运行一次',
  archived: '已归档账号',
  restore: '恢复账号',
  delete: '永久移除记录',
  deleteConfirm: '永久移除“{name}”的账号记录？浏览器数据目录不会被删除。',
  noAccountsInDirectory: '此目录目前没有活动账号',
  renameDirectory: '重命名目录',
  renameDirectoryPrompt: '输入新的目录显示名称。磁盘地址不会改变。',
  archiveDirectory: '归档目录',
  archiveDirectoryConfirm: '归档“{name}”？目录和本机浏览器数据都会保留。',
  archiveDirectoryBlocked: '需先关闭浏览器并归档目录内所有活动账号',
  archivedDirectories: '已归档浏览器数据目录',
  restoreDirectory: '恢复目录',
  deleteDirectory: '删除目录记录',
  deleteDirectoryTitle: '删除浏览器数据目录',
  deleteDirectoryImpact: '删除目录记录时，会同时永久移除引用它的 {count} 个归档账号记录。',
  preserveLocalData: '仅移除目录登记，保留本机文件',
  deleteLocalData: '移除登记并删除本机浏览器数据',
  deleteLocalDataUnavailable: '自定义目录和旧版目录只能移除登记，插件不会删除其本机文件。',
  typeDirectoryName: '输入目录名称“{name}”以确认删除本机数据',
  deleteDirectoryConfirm: '确认删除',
  unknownError: '操作失败',
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
}

const en: typeof zh = {
  nav: 'Platform management',
  title: 'Platform management',
  subtitle: 'Manage platform accounts, browser data roots, profiles, and sign-in status',
  add: 'Add account',
  refresh: 'Refresh status',
  summary: '{accounts} accounts · {directories} browser data directories',
  privacy: 'Passwords are never stored. Cookies, site storage, and browser settings remain only in the selected local directory.',
  emptyTitle: 'No platform accounts',
  emptyBody: 'Add an account and select a browser data root and profile.',
  directory: 'Browser data root and profile',
  newDirectory: 'New data root',
  existingDirectory: 'Reuse data root',
  directoryName: 'Directory name',
  directoryPath: 'Custom directory path (optional)',
  chooseDirectory: 'Choose directory',
  copyPath: 'Copy directory path',
  copied: 'Copied',
  revealDirectory: 'Open directory',
  syncCookies: 'Sync cookies now',
  closeBrowser: 'Close browser',
  closeSharedConfirm: 'This browser data directory is shared by {count} accounts. Closing it closes all their pages. Continue?',
  online: 'Online',
  offline: 'Offline',
  pages: '{count} pages',
  cookieIdle: 'Cookies not synced',
  cookieOk: 'Cookies synced',
  cookieError: 'Cookie sync failed',
  accountCount: '{count} accounts',
  activeAccountCount: '{count} active accounts',
  archivedAccountCount: '{count} archived accounts',
  createTitle: 'Add platform account',
  editTitle: 'Edit platform account',
  platformName: 'Platform name',
  platformPlaceholder: 'For example: Shopify, Slack, Amazon',
  accountName: 'Account name',
  accountNamePlaceholder: 'A name that identifies this account',
  profileUserIdentifier: 'User identifier',
  profileUserIdentifierPlaceholder: 'For example: Store A operator',
  backendUrl: 'Platform backend URL',
  loginUrl: 'Login URL',
  urlRequired: 'Enter at least one backend or login URL.',
  agentInstructions: 'Agent instructions (optional)',
  agentPlaceholder: 'Business context and intended use; this is not permission enforcement.',
  browser: 'Browser',
  selectDirectory: 'Select an existing directory',
  selectProfile: 'Browser profile',
  profile: 'Profile',
  inspectDirectory: 'Inspect another data root',
  scanComputer: 'Scan this computer',
  searchAccounts: 'Search account ID, platform, account name, or user identifier',
  noSearchResults: 'No matching platform accounts',
  noProfiles: 'This data root has no usable browser profiles.',
  profileInUse: 'This profile is already bound to {count} platform accounts. They share cookies and site storage.',
  sameSiteProfileRisk: 'This profile already has an account for the same site. Reusing it may overwrite the signed-in identity.',
  activeProfile: 'Active profile: {name}',
  create: 'Create account',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  openPlatform: 'Open platform',
  checkLogin: 'Check sign-in',
  confirmLogin: 'Mark as signed in manually',
  loginCheckTitle: 'Sign-in check result',
  automaticCheck: 'Automatic check',
  edit: 'Edit account',
  archive: 'Archive account',
  archiveConfirm: 'Archive “{name}”? Its browser directory and sign-in data remain on this computer.',
  loginValid: 'Signed in',
  loginInvalid: 'Sign-in expired',
  loginUnknown: 'Cannot determine',
  loginError: 'Check failed',
  loginUnchecked: 'Not checked',
  manuallyReady: 'Manual confirmation',
  platformOpen: 'Page open',
  browserOnline: 'Browser online',
  browserOffline: 'Browser offline',
  keepAlive: 'Session keepalive',
  keepAliveOn: 'Keepalive enabled',
  keepAliveOff: 'Keepalive disabled',
  keepAliveTitle: 'Session keepalive',
  enabled: 'Enable scheduled keepalive',
  intervalHours: 'Interval (hours)',
  jitterMinutes: 'Random delay (minutes)',
  activeStart: 'Active from',
  activeEnd: 'Active until',
  closeAfterRun: 'Close the browser when this run started it',
  nextRun: 'Next run',
  lastRun: 'Last run',
  never: 'None',
  runNow: 'Run once now',
  archived: 'Archived accounts',
  restore: 'Restore account',
  delete: 'Remove record permanently',
  deleteConfirm: 'Permanently remove the record for “{name}”? The browser data directory will not be deleted.',
  noAccountsInDirectory: 'No active accounts use this directory',
  renameDirectory: 'Rename directory',
  renameDirectoryPrompt: 'Enter a new display name. The disk path will not change.',
  archiveDirectory: 'Archive directory',
  archiveDirectoryConfirm: 'Archive “{name}”? The directory and local browser data will remain.',
  archiveDirectoryBlocked: 'Close the browser and archive every active account in this directory first',
  archivedDirectories: 'Archived browser data directories',
  restoreDirectory: 'Restore directory',
  deleteDirectory: 'Delete directory record',
  deleteDirectoryTitle: 'Delete browser data directory',
  deleteDirectoryImpact: 'Deleting this directory record also permanently removes {count} archived account records that reference it.',
  preserveLocalData: 'Remove registration and preserve local files',
  deleteLocalData: 'Remove registration and delete local browser data',
  deleteLocalDataUnavailable: 'Custom and legacy directories can only be unregistered. Their local files are never deleted by the plugin.',
  typeDirectoryName: 'Enter “{name}” to confirm deletion of local data',
  deleteDirectoryConfirm: 'Confirm deletion',
  unknownError: 'Operation failed',
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    platformManagement: keyof typeof zh
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? `{${key}}`))
}

function hostname(value: string): string {
  if (!value) return ''
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

function relatedHostname(left: string, right: string): boolean {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  return Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)))
}

function formatTime(value: string | undefined, never: string): string {
  if (!value) return never
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return never
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function IconButton(props: {
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  active?: boolean
  children: ReactNode
}): ReactNode {
  return <button
    className="sam_iconButton"
    data-danger={props.danger || undefined}
    data-active={props.active || undefined}
    type="button"
    onClick={props.onClick}
    disabled={props.disabled}
    title={props.title}
    aria-label={props.title}
  >{props.children}</button>
}

function Modal(props: { title: string, closeLabel: string, busy?: boolean, onClose: () => void, children: ReactNode }): ReactNode {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !props.busy) props.onClose()
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [props.busy, props.onClose])
  return <div className="sam_overlay" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !props.busy) props.onClose()
  }}>
    <div className="sam_modal" role="dialog" aria-modal="true" aria-label={props.title}>
      <header className="sam_modalHeader">
        <h3>{props.title}</h3>
        <IconButton title={props.closeLabel} onClick={props.onClose} disabled={props.busy}><X size={17} /></IconButton>
      </header>
      {props.children}
    </div>
  </div>
}

interface AccountDraft {
  name: string
  platformName: string
  profileUserIdentifier: string
  shopUrl: string
  loginUrl: string
  agentInstructions: string
  directoryMode: 'new' | 'existing'
  existingDirectoryKey: string
  profileDirectory: string
  directoryName: string
  browser: BrowserKind
  directoryPath: string
}

function accountDraft(account: PublicPlatformAccount | undefined, directories: DiscoveredBrowserDataDirectory[]): AccountDraft {
  if (account) return {
    name: account.name,
    platformName: account.platformName,
    profileUserIdentifier: account.profile.userIdentifier,
    shopUrl: account.shopUrl,
    loginUrl: account.loginUrl,
    agentInstructions: account.agentInstructions,
    directoryMode: 'existing',
    existingDirectoryKey: directories.find(directory => directory.registeredDirectoryId === account.browserDataDirectoryId)?.key || '',
    profileDirectory: account.profile.directoryName,
    directoryName: account.directory.name,
    browser: account.directory.browser,
    directoryPath: account.directory.path,
  }
  return {
    name: '',
    platformName: '',
    profileUserIdentifier: directories[0]?.profiles[0]?.userIdentifier || '',
    shopUrl: '',
    loginUrl: '',
    agentInstructions: '',
    directoryMode: directories.length ? 'existing' : 'new',
    existingDirectoryKey: directories[0]?.key || '',
    profileDirectory: directories[0]?.profiles[0]?.directoryName || '',
    directoryName: '',
    browser: 'chrome',
    directoryPath: '',
  }
}

function AccountModal(props: {
  account?: PublicPlatformAccount
  availableDirectories: DiscoveredBrowserDataDirectory[]
  accounts: PublicPlatformAccount[]
  platformNames: string[]
  manager: ManagerProps
  onClose: () => void
}): ReactNode {
  const { account, availableDirectories, manager, onClose } = props
  const [form, setForm] = useState(() => accountDraft(account, availableDirectories))
  const [manualDirectories, setManualDirectories] = useState<DiscoveredBrowserDataDirectory[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string>()
  const t = manager.t
  const directories = useMemo(() => {
    const merged = new Map(availableDirectories.map(directory => [directory.key, directory]))
    for (const directory of manualDirectories) merged.set(directory.key, directory)
    return [...merged.values()]
  }, [availableDirectories, manualDirectories])
  const selectedDirectory = directories.find(directory => directory.key === form.existingDirectoryKey)
  const selectedProfile = selectedDirectory?.profiles.find(profile => profile.directoryName === form.profileDirectory)
  const boundAccounts = selectedDirectory?.registeredDirectoryId
    ? props.accounts.filter(candidate => candidate.browserDataDirectoryId === selectedDirectory.registeredDirectoryId
      && candidate.profile.directoryName === form.profileDirectory)
    : []
  const selectedHost = hostname(form.shopUrl || form.loginUrl)
  const sameSiteRisk = boundAccounts.some(candidate => relatedHostname(
    selectedHost,
    hostname(candidate.shopUrl || candidate.loginUrl),
  ))
  const set = <K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) => setForm(current => ({ ...current, [key]: value }))
  const pick = async () => {
    setPicking(true)
    setError(undefined)
    try {
      const path = await manager.pickDirectory()
      if (path) set('directoryPath', path)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setPicking(false)
    }
  }
  const inspect = async () => {
    setPicking(true)
    setError(undefined)
    try {
      const path = await manager.pickDirectory()
      if (!path) return
      const inspected = await manager.inspectDirectory(form.browser, path)
      if (!inspected) return
      setManualDirectories(current => [...current.filter(item => item.key !== inspected.key), inspected])
      setForm(current => ({
        ...current,
        directoryMode: 'existing',
        existingDirectoryKey: inspected.key,
        profileDirectory: inspected.profiles[0]?.directoryName || '',
        profileUserIdentifier: inspected.profiles[0]?.userIdentifier || '',
        browser: inspected.browser,
      }))
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setPicking(false)
    }
  }
  const scanComputer = async () => {
    setPicking(true)
    setError(undefined)
    try {
      await manager.scanComputer()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setPicking(false)
    }
  }
  const selectExistingDirectory = (key: string) => {
    const directory = directories.find(candidate => candidate.key === key)
    setForm(current => ({
      ...current,
      existingDirectoryKey: key,
      profileDirectory: directory?.profiles[0]?.directoryName || '',
      profileUserIdentifier: directory?.profiles[0]?.userIdentifier || '',
      browser: directory?.browser || current.browser,
    }))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.shopUrl.trim() && !form.loginUrl.trim()) {
      setError(t('urlRequired'))
      return
    }
    setSubmitting(true)
    setError(undefined)
    const input: PlatformAccountInput = {
      name: form.name,
      platformName: form.platformName,
      shopUrl: form.shopUrl,
      loginUrl: form.loginUrl,
      agentInstructions: form.agentInstructions,
      ...(account ? {
        browserDataDirectoryId: account.browserDataDirectoryId,
        browserProfileId: account.browserProfileId,
      } : {}),
    }
    try {
      if (account) {
        await manager.updateAccount(account.id, input)
        if (form.profileUserIdentifier !== account.profile.userIdentifier) {
          await manager.renameProfile(account.profile.id, form.profileUserIdentifier)
        }
      } else {
        let directory: BrowserDirectorySelection
        if (form.directoryMode === 'existing') {
          if (!selectedDirectory || !selectedProfile) throw new Error(t('noProfiles'))
          directory = selectedDirectory.registeredDirectoryId
            ? {
                mode: 'existing',
                id: selectedDirectory.registeredDirectoryId,
                profileDirectory: selectedProfile.directoryName,
                profileName: selectedProfile.name,
                profileUserIdentifier: form.profileUserIdentifier,
              }
            : {
                mode: 'discovered',
                browser: form.browser,
                path: selectedDirectory.path,
                name: selectedDirectory.name,
                profileDirectory: selectedProfile.directoryName,
                profileName: selectedProfile.name,
                profileUserIdentifier: form.profileUserIdentifier,
              }
        } else {
          directory = {
              mode: 'new',
              directory: {
                name: form.directoryName || undefined,
                browser: form.browser,
                path: form.directoryPath || undefined,
                profileUserIdentifier: form.profileUserIdentifier,
              },
            }
        }
        await manager.createAccount(input, directory)
      }
      onClose()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSubmitting(false)
    }
  }
  return <Modal title={t(account ? 'editTitle' : 'createTitle')} closeLabel={t('close')} busy={submitting || picking} onClose={onClose}>
    <form className="sam_form" onSubmit={event => void submit(event)}>
      {error && <div className="sam_error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
      <div className="sam_fieldGrid">
        <div className="sam_field">
          <label htmlFor="sam-platform">{t('platformName')}</label>
          <input id="sam-platform" list="sam-platform-presets" required maxLength={100} value={form.platformName}
            placeholder={t('platformPlaceholder')} onChange={event => set('platformName', event.target.value)} />
          <datalist id="sam-platform-presets">{props.platformNames.map(name => <option key={name} value={name} />)}</datalist>
        </div>
        <div className="sam_field">
          <label htmlFor="sam-name">{t('accountName')}</label>
          <input id="sam-name" required maxLength={120} value={form.name} placeholder={t('accountNamePlaceholder')}
            onChange={event => set('name', event.target.value)} />
        </div>
      </div>

      {!account && <fieldset className="sam_fieldset">
        <legend>{t('directory')}</legend>
        <div className="sam_segmented">
          <label data-selected={form.directoryMode === 'new'}>
            <input type="radio" name="directory-mode" checked={form.directoryMode === 'new'} onChange={() => set('directoryMode', 'new')} />
            {t('newDirectory')}
          </label>
          <label data-selected={form.directoryMode === 'existing'}>
            <input type="radio" name="directory-mode" checked={form.directoryMode === 'existing'}
              onChange={() => set('directoryMode', 'existing')} />
            {t('existingDirectory')}
          </label>
        </div>
        {form.directoryMode === 'existing' ? <div className="sam_fieldGrid">
          <div className="sam_field" data-wide="true">
            <label htmlFor="sam-directory-existing">{t('selectDirectory')}</label>
            <select id="sam-directory-existing" required value={form.existingDirectoryKey}
              onChange={event => selectExistingDirectory(event.target.value)}>
              {!directories.length && <option value="">{t('chooseDirectory')}</option>}
              {directories.map(directory => <option key={directory.key} value={directory.key}>
                {directory.name} · {browserLabel(directory.browser)} · {directory.path}
              </option>)}
            </select>
          </div>
          <div className="sam_field">
            <label htmlFor="sam-inspect-browser">{t('browser')}</label>
            <select id="sam-inspect-browser" value={form.browser} disabled={Boolean(selectedDirectory?.registeredDirectoryId)}
              onChange={event => set('browser', event.target.value as BrowserKind)}>
              <option value="chrome">{t('chrome')}</option>
              <option value="edge">{t('edge')}</option>
            </select>
          </div>
          <div className="sam_field sam_fieldAction">
            <button className="sam_secondaryButton" type="button" disabled={picking} onClick={() => void inspect()}>
              {picking ? <LoaderCircle className="sam_spinner" size={15} /> : <FolderOpen size={15} />}{t('inspectDirectory')}
            </button>
          </div>
          <div className="sam_field sam_fieldAction" data-wide="true">
            <button className="sam_secondaryButton" type="button" disabled={picking} onClick={() => void scanComputer()}>
              {picking ? <LoaderCircle className="sam_spinner" size={15} /> : <HardDrive size={15} />}{t('scanComputer')}
            </button>
          </div>
          <div className="sam_field" data-wide="true">
            <label htmlFor="sam-profile-existing">{t('selectProfile')}</label>
            <select id="sam-profile-existing" required value={form.profileDirectory}
              onChange={event => {
                const selected = selectedDirectory?.profiles.find(profile => profile.directoryName === event.target.value)
                setForm(current => ({
                  ...current,
                  profileDirectory: event.target.value,
                  profileUserIdentifier: selected?.userIdentifier || selected?.name || '',
                }))
              }}>
              {!selectedDirectory?.profiles.length && <option value="">{t('noProfiles')}</option>}
              {selectedDirectory?.profiles.map(profile => <option key={profile.directoryName} value={profile.directoryName}>
                {profile.userIdentifier} · {profile.directoryName}{profile.accountCount ? ` · ${t('accountCount', { count: profile.accountCount })}` : ''}
              </option>)}
            </select>
          </div>
          {selectedProfile && selectedProfile.accountCount > 0 && <div className="sam_notice" data-wide="true">
            <Info size={15} /><span>{t('profileInUse', { count: selectedProfile.accountCount })}</span>
          </div>}
          {sameSiteRisk && <div className="sam_error" data-wide="true" role="alert">
            <CircleAlert size={16} /><span>{t('sameSiteProfileRisk')}</span>
          </div>}
        </div> : <div className="sam_fieldGrid">
          <div className="sam_field">
            <label htmlFor="sam-directory-name">{t('directoryName')}</label>
            <input id="sam-directory-name" maxLength={120} value={form.directoryName} placeholder={form.name || t('directoryName')}
              onChange={event => set('directoryName', event.target.value)} />
          </div>
          <div className="sam_field">
            <label htmlFor="sam-browser">{t('browser')}</label>
            <select id="sam-browser" value={form.browser} onChange={event => set('browser', event.target.value as BrowserKind)}>
              <option value="chrome">{t('chrome')}</option>
              <option value="edge">{t('edge')}</option>
            </select>
          </div>
          <div className="sam_field" data-wide="true">
            <label htmlFor="sam-directory-path">{t('directoryPath')}</label>
            <div className="sam_inputAction">
              <input id="sam-directory-path" value={form.directoryPath} onChange={event => set('directoryPath', event.target.value)} />
              <button className="sam_secondaryButton" type="button" disabled={picking} onClick={() => void pick()}>
                {picking ? <LoaderCircle className="sam_spinner" size={15} /> : <FolderOpen size={15} />}{t('chooseDirectory')}
              </button>
            </div>
          </div>
        </div>}
      </fieldset>}

      {account && <div className="sam_readonlyDirectory">
        <HardDrive size={16} />
        <div><strong>{account.directory.name} · {account.profile.name}</strong><span>{account.directory.path} · {account.profile.directoryName}</span></div>
      </div>}
      <div className="sam_fieldGrid">
        <div className="sam_field" data-wide="true">
          <label htmlFor="sam-profile-identifier">{t('profileUserIdentifier')}</label>
          <input id="sam-profile-identifier" required maxLength={120} value={form.profileUserIdentifier}
            placeholder={t('profileUserIdentifierPlaceholder')} onChange={event => set('profileUserIdentifier', event.target.value)} />
        </div>
        <div className="sam_field" data-wide="true">
          <label htmlFor="sam-shop-url">{t('backendUrl')}</label>
          <input id="sam-shop-url" type="url" maxLength={2048} value={form.shopUrl} placeholder="https://..."
            onChange={event => set('shopUrl', event.target.value)} />
        </div>
        <div className="sam_field" data-wide="true">
          <label htmlFor="sam-login-url">{t('loginUrl')}</label>
          <input id="sam-login-url" type="url" maxLength={2048} value={form.loginUrl} placeholder="https://..."
            onChange={event => set('loginUrl', event.target.value)} />
        </div>
        <div className="sam_field" data-wide="true">
          <label htmlFor="sam-agent-instructions">{t('agentInstructions')}</label>
          <textarea id="sam-agent-instructions" maxLength={4000} value={form.agentInstructions}
            placeholder={t('agentPlaceholder')} onChange={event => set('agentInstructions', event.target.value)} />
        </div>
      </div>
      <div className="sam_formActions">
        <button className="sam_secondaryButton" type="button" disabled={submitting || picking} onClick={onClose}>{t('cancel')}</button>
        <button className="sam_primaryButton" type="submit" disabled={submitting || picking}>
          {submitting && <LoaderCircle className="sam_spinner" size={15} />}{t(account ? 'save' : 'create')}
        </button>
      </div>
    </form>
  </Modal>
}

function KeepAliveModal(props: { account: PublicPlatformAccount, manager: ManagerProps, onClose: () => void }): ReactNode {
  const { account, manager, onClose } = props
  const t = manager.t
  const [form, setForm] = useState({ ...account.keepAlive })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const set = <K extends keyof KeepAliveSettings>(key: K, value: KeepAliveSettings[K]) => setForm(current => ({ ...current, [key]: value }))
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await manager.setKeepAlive(account.id, form)
      onClose()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }
  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await manager.runKeepAlive(account.id)
      onClose()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }
  return <Modal title={t('keepAliveTitle')} closeLabel={t('close')} busy={busy} onClose={onClose}>
    <form className="sam_form" onSubmit={event => void save(event)}>
      {error && <div className="sam_error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
      <label className="sam_toggleRow">
        <span><strong>{t('enabled')}</strong></span>
        <input type="checkbox" checked={form.enabled} onChange={event => set('enabled', event.target.checked)} />
      </label>
      <div className="sam_fieldGrid">
        <div className="sam_field">
          <label htmlFor="sam-interval">{t('intervalHours')}</label>
          <input id="sam-interval" type="number" min={1} max={720} step={1} value={form.intervalHours}
            onChange={event => set('intervalHours', Number(event.target.value))} />
        </div>
        <div className="sam_field">
          <label htmlFor="sam-jitter">{t('jitterMinutes')}</label>
          <input id="sam-jitter" type="number" min={0} max={240} step={1} value={form.jitterMinutes}
            onChange={event => set('jitterMinutes', Number(event.target.value))} />
        </div>
        <div className="sam_field">
          <label htmlFor="sam-active-start">{t('activeStart')}</label>
          <input id="sam-active-start" type="time" value={form.activeStart} onChange={event => set('activeStart', event.target.value)} />
        </div>
        <div className="sam_field">
          <label htmlFor="sam-active-end">{t('activeEnd')}</label>
          <input id="sam-active-end" type="time" value={form.activeEnd} onChange={event => set('activeEnd', event.target.value)} />
        </div>
      </div>
      <label className="sam_checkRow">
        <input type="checkbox" checked={form.closeAfterRun} onChange={event => set('closeAfterRun', event.target.checked)} />
        <span>{t('closeAfterRun')}</span>
      </label>
      <div className="sam_runMeta">
        <span><strong>{t('nextRun')}</strong>{formatTime(account.keepAlive.nextRunAt, t('never'))}</span>
        <span><strong>{t('lastRun')}</strong>{formatTime(account.keepAlive.lastRunAt, t('never'))}</span>
      </div>
      <div className="sam_formActions sam_formActionsSplit">
        <button className="sam_secondaryButton" type="button" disabled={busy} onClick={() => void run()}>
          <RotateCw size={15} />{t('runNow')}
        </button>
        <span className="sam_actionSpacer" />
        <button className="sam_secondaryButton" type="button" disabled={busy} onClick={onClose}>{t('cancel')}</button>
        <button className="sam_primaryButton" type="submit" disabled={busy}>{busy && <LoaderCircle className="sam_spinner" size={15} />}{t('save')}</button>
      </div>
    </form>
  </Modal>
}

function loginStatus(account: PublicPlatformAccount, t: Translate): { state: string, label: string } {
  if (account.loginStatusSource === 'manual' && account.loginState === 'ready') return { state: 'success', label: t('manuallyReady') }
  if (account.loginCheckState === 'valid') return { state: 'success', label: t('loginValid') }
  if (account.loginCheckState === 'invalid') return { state: 'danger', label: t('loginInvalid') }
  if (account.loginCheckState === 'error') return { state: 'danger', label: t('loginError') }
  if (account.loginCheckState === 'unknown') return { state: 'warning', label: t('loginUnknown') }
  if (account.loginState === 'ready') return { state: 'success', label: t('manuallyReady') }
  return { state: 'neutral', label: t('loginUnchecked') }
}

function LoginResultModal(props: {
  account: PublicPlatformAccount
  result: LoginCheckResult
  manager: ManagerProps
  onClose: () => void
}): ReactNode {
  const { account, result, manager, onClose } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const status = result.state === 'valid'
    ? { icon: <CircleCheck size={22} />, state: 'success', label: manager.t('loginValid') }
    : result.state === 'invalid'
      ? { icon: <CircleAlert size={22} />, state: 'danger', label: manager.t('loginInvalid') }
      : result.state === 'error'
        ? { icon: <CircleAlert size={22} />, state: 'danger', label: manager.t('loginError') }
        : { icon: <Info size={22} />, state: 'warning', label: manager.t('loginUnknown') }
  const manualConfirm = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await manager.manualConfirmLogin(account.id)
      onClose()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }
  return <Modal title={manager.t('loginCheckTitle')} closeLabel={manager.t('close')} busy={busy} onClose={onClose}>
    <div className="sam_form">
      {error && <div className="sam_error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
      <div className="sam_result" data-state={status.state}>
        {status.icon}
        <div><strong>{status.label}</strong><span>{account.platformName} · {account.name}</span></div>
      </div>
      <div className="sam_resultDetails">
        <p>{result.message}</p>
        {result.finalUrl && <span>{result.finalUrl}</span>}
        <span>{manager.t('automaticCheck')} · {formatTime(result.checkedAt, manager.t('never'))}</span>
      </div>
      <div className="sam_formActions">
        {(result.state === 'unknown' || result.state === 'error') && <button className="sam_secondaryButton" type="button" disabled={busy} onClick={() => void manualConfirm()}>
          {busy ? <LoaderCircle className="sam_spinner" size={15} /> : <CircleCheck size={15} />}{manager.t('confirmLogin')}
        </button>}
        <button className="sam_primaryButton" type="button" disabled={busy} onClick={onClose}>{manager.t('close')}</button>
      </div>
    </div>
  </Modal>
}

function AccountRow(props: {
  account: PublicPlatformAccount
  manager: ManagerProps
  onEdit: () => void
  onKeepAlive: () => void
  onCheckLogin: () => void
}): ReactNode {
  const { account, manager, onEdit, onKeepAlive, onCheckLogin } = props
  const snapshot = manager.useDirectory(value => value)
  const busy = snapshot.busyKeys.some(key => key === `account:${account.id}` || key === `directory:${account.browserDataDirectoryId}`)
  const status = loginStatus(account, manager.t)
  const t = manager.t
  const archiveAccount = async () => {
    if (window.confirm(interpolate(t('archiveConfirm'), { name: account.name }))) await manager.archiveAccount(account.id)
  }
  return <li className="sam_accountRow">
    <div className="sam_accountIdentity">
      <div className="sam_nameLine">
        <code className="sam_accountId" title={account.id}>{account.id}</code>
        <strong>{account.name}</strong>
        <span className="sam_platformTag">{account.platformName}</span>
      </div>
      <div className="sam_metaLine">
        <span>{account.profile.userIdentifier}</span>
        {(account.shopUrl || account.loginUrl) && <span>{hostname(account.shopUrl || account.loginUrl)}</span>}
        <span>{t('profile')} · {account.profile.directoryName}</span>
        <span title={`${account.directory.path}\\${account.profile.directoryName}`}>{account.directory.path}\{account.profile.directoryName}</span>
        <span>{account.status.platformOpen ? t('platformOpen') : account.status.browserOnline ? t('browserOnline') : t('browserOffline')}</span>
        {account.loginStatusSource && <span>{t(account.loginStatusSource === 'manual' ? 'manuallyReady' : 'automaticCheck')} · {formatTime(
          account.loginStatusSource === 'manual' ? account.lastLoginValidAt : account.lastLoginCheckAt,
          t('never'),
        )}</span>}
      </div>
    </div>
    <div className="sam_accountStatus">
      <span className="sam_statusPill" data-state={status.state}><span />{status.label}</span>
      <span className="sam_keepAliveMark" data-active={account.keepAlive.enabled || undefined} title={t(account.keepAlive.enabled ? 'keepAliveOn' : 'keepAliveOff')}>
        <Clock size={13} />
      </span>
    </div>
    <div className="sam_actions">
      <IconButton title={t('openPlatform')} disabled={busy} onClick={() => void manager.openAccount(account.id)}><ExternalLink size={16} /></IconButton>
      <IconButton title={t('checkLogin')} disabled={busy} onClick={onCheckLogin}><ShieldCheck size={16} /></IconButton>
      <IconButton title={t('syncCookies')} disabled={busy || !account.status.browserOnline}
        onClick={() => void manager.syncCookies(account.profile.id)}><RefreshCw size={16} /></IconButton>
      {account.status.browserOnline && <IconButton title={t('closeBrowser')} disabled={busy} danger
        onClick={() => void manager.closeBrowser(account.id)}><Power size={16} /></IconButton>}
      <IconButton title={t('keepAlive')} disabled={busy} active={account.keepAlive.enabled} onClick={onKeepAlive}><Timer size={16} /></IconButton>
      <IconButton title={t('edit')} disabled={busy} onClick={onEdit}><Pencil size={16} /></IconButton>
      <IconButton title={t('archive')} disabled={busy} danger onClick={() => void archiveAccount()}><Archive size={16} /></IconButton>
    </div>
  </li>
}

function DirectoryGroup(props: {
  directory: PublicBrowserDataDirectory
  accounts: PublicPlatformAccount[]
  manager: ManagerProps
  onEdit: (account: PublicPlatformAccount) => void
  onKeepAlive: (account: PublicPlatformAccount) => void
  onCheckLogin: (account: PublicPlatformAccount) => void
}): ReactNode {
  const { directory, accounts, manager, onEdit, onKeepAlive, onCheckLogin } = props
  const t = manager.t
  const snapshot = manager.useDirectory(value => value)
  const busy = snapshot.busyKeys.includes(`directory:${directory.id}`)
  const [copied, setCopied] = useState(false)
  const copyPath = async () => {
    await navigator.clipboard.writeText(directory.path)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  const rename = async () => {
    const name = window.prompt(t('renameDirectoryPrompt'), directory.name)?.trim()
    if (name && name !== directory.name) await manager.renameDirectory(directory.id, name)
  }
  const archive = async () => {
    if (window.confirm(interpolate(t('archiveDirectoryConfirm'), { name: directory.name }))) await manager.archiveDirectory(directory.id)
  }
  const profileGroups = [...new Map(accounts.map(account => [account.profile.id, account.profile])).values()]
  return <section className="sam_directoryGroup">
    <header className="sam_directoryHeader">
      <div className="sam_directoryIcon"><HardDrive size={18} /></div>
      <div className="sam_directoryIdentity">
        <div className="sam_nameLine">
          <h3>{directory.name}</h3>
          <span className="sam_browserTag">{browserLabel(directory.browser)}</span>
          <span className="sam_onlineTag" data-online={directory.status.online || undefined}>{directory.status.online ? t('online') : t('offline')}</span>
        </div>
        <div className="sam_directoryMeta">
          <span>{interpolate(t('activeAccountCount'), { count: directory.activeAccountCount })}</span>
          <span>{interpolate(t('archivedAccountCount'), { count: directory.archivedAccountCount })}</span>
          <span>{interpolate(t('pages'), { count: directory.status.pages })}</span>
          {directory.status.onlineProfileNames.length > 0 && <span>{interpolate(t('activeProfile'), { name: directory.status.onlineProfileNames.join('、') })}</span>}
        </div>
      </div>
      <div className="sam_actions sam_directoryActions">
        <IconButton title={copied ? t('copied') : t('copyPath')} onClick={() => void copyPath()}>{copied ? <Check size={16} /> : <Copy size={16} />}</IconButton>
        <IconButton title={t('revealDirectory')} disabled={busy} onClick={() => void manager.revealDirectory(directory.id)}><FolderOpen size={16} /></IconButton>
        <IconButton title={t('renameDirectory')} disabled={busy} onClick={() => void rename()}><Pencil size={16} /></IconButton>
        <IconButton title={directory.status.online || directory.activeAccountCount ? t('archiveDirectoryBlocked') : t('archiveDirectory')}
          disabled={busy || directory.status.online || directory.activeAccountCount > 0} onClick={() => void archive()}><Archive size={16} /></IconButton>
      </div>
      <div className="sam_path" title={directory.path}>{directory.path}</div>
    </header>
    {accounts.length ? <div className="sam_profileGroups">{profileGroups.map(profile => {
      const profileAccounts = accounts.filter(account => account.browserProfileId === profile.id)
      return <section className="sam_profileGroup" key={profile.id}>
        <header className="sam_profileHeader">
          <strong>{profile.userIdentifier}</strong><span>{profile.name} · {profile.directoryName}</span>
          <span>{interpolate(t('accountCount'), { count: profileAccounts.length })}</span>
        </header>
        <ul className="sam_accountList">{profileAccounts.map(account => <AccountRow
          key={account.id}
          account={account}
          manager={manager}
          onEdit={() => onEdit(account)}
          onKeepAlive={() => onKeepAlive(account)}
          onCheckLogin={() => onCheckLogin(account)}
        />)}</ul>
      </section>
    })}</div> : <div className="sam_directoryEmpty">{t('noAccountsInDirectory')}</div>}
  </section>
}

function DeleteDirectoryModal(props: {
  directory: PublicBrowserDataDirectory
  manager: ManagerProps
  onClose: () => void
}): ReactNode {
  const { directory, manager, onClose } = props
  const [deleteLocalData, setDeleteLocalData] = useState(false)
  const [confirmationName, setConfirmationName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const canDeleteLocalData = directory.origin === 'plugin-created'
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await manager.deleteDirectory(directory.id, deleteLocalData, deleteLocalData ? confirmationName : undefined)
      onClose()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }
  return <Modal title={manager.t('deleteDirectoryTitle')} closeLabel={manager.t('close')} busy={busy} onClose={onClose}>
    <form className="sam_form" onSubmit={event => void submit(event)}>
      {error && <div className="sam_error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
      <div className="sam_notice"><Info size={16} /><span>{interpolate(manager.t('deleteDirectoryImpact'), { count: directory.archivedAccountCount })}</span></div>
      <div className="sam_deleteModes">
        <label data-selected={!deleteLocalData}>
          <input type="radio" name="delete-mode" checked={!deleteLocalData} onChange={() => setDeleteLocalData(false)} />
          <span><strong>{manager.t('preserveLocalData')}</strong><small>{directory.path}</small></span>
        </label>
        <label data-selected={deleteLocalData} data-disabled={!canDeleteLocalData}>
          <input type="radio" name="delete-mode" checked={deleteLocalData} disabled={!canDeleteLocalData} onChange={() => setDeleteLocalData(true)} />
          <span><strong>{manager.t('deleteLocalData')}</strong><small>{canDeleteLocalData ? directory.path : manager.t('deleteLocalDataUnavailable')}</small></span>
        </label>
      </div>
      {deleteLocalData && <div className="sam_field">
        <label htmlFor="sam-delete-directory-confirm">{interpolate(manager.t('typeDirectoryName'), { name: directory.name })}</label>
        <input id="sam-delete-directory-confirm" required autoComplete="off" value={confirmationName}
          onChange={event => setConfirmationName(event.target.value)} />
      </div>}
      <div className="sam_formActions">
        <button className="sam_secondaryButton" type="button" disabled={busy} onClick={onClose}>{manager.t('cancel')}</button>
        <button className="sam_primaryButton" type="submit" disabled={busy || (deleteLocalData && confirmationName !== directory.name)}>
          {busy ? <LoaderCircle className="sam_spinner" size={15} /> : <Trash2 size={15} />}{manager.t('deleteDirectoryConfirm')}
        </button>
      </div>
    </form>
  </Modal>
}

function ArchivedDirectories(props: {
  manager: ManagerProps
  directories: PublicBrowserDataDirectory[]
  onDelete: (directory: PublicBrowserDataDirectory) => void
}): ReactNode {
  const { manager, directories, onDelete } = props
  if (!directories.length) return null
  const rename = async (directory: PublicBrowserDataDirectory) => {
    const name = window.prompt(manager.t('renameDirectoryPrompt'), directory.name)?.trim()
    if (name && name !== directory.name) await manager.renameDirectory(directory.id, name)
  }
  return <details className="sam_archived">
    <summary><HardDrive size={15} />{manager.t('archivedDirectories')}<span>{directories.length}</span></summary>
    <ul>{directories.map(directory => <li key={directory.id} className="sam_archivedDirectoryItem">
      <div>
        <strong>{directory.name}</strong>
        <span>{browserLabel(directory.browser)} · {interpolate(manager.t('archivedAccountCount'), { count: directory.archivedAccountCount })}</span>
        <span className="sam_archivedPath">{directory.path}</span>
      </div>
      <div className="sam_actions">
        <IconButton title={manager.t('revealDirectory')} onClick={() => void manager.revealDirectory(directory.id)}><FolderOpen size={16} /></IconButton>
        <IconButton title={manager.t('renameDirectory')} onClick={() => void rename(directory)}><Pencil size={16} /></IconButton>
        <IconButton title={manager.t('restoreDirectory')} onClick={() => void manager.restoreDirectory(directory.id)}><RotateCw size={16} /></IconButton>
        <IconButton title={manager.t('deleteDirectory')} danger onClick={() => onDelete(directory)}><Trash2 size={16} /></IconButton>
      </div>
    </li>)}</ul>
  </details>
}

function ArchivedAccounts(props: { manager: ManagerProps, accounts: PublicPlatformAccount[] }): ReactNode {
  const { manager, accounts } = props
  if (!accounts.length) return null
  const remove = async (account: PublicPlatformAccount) => {
    if (window.confirm(interpolate(manager.t('deleteConfirm'), { name: account.name }))) await manager.deleteAccount(account.id)
  }
  return <details className="sam_archived">
    <summary><Archive size={15} />{manager.t('archived')}<span>{accounts.length}</span></summary>
    <ul>{accounts.map(account => <li key={account.id}>
      <div><strong>{account.name}</strong><span>{account.platformName} · {account.directory.name}</span></div>
      <div className="sam_actions">
        <IconButton title={account.directory.archivedAt ? manager.t('restoreDirectory') : manager.t('restore')}
          disabled={Boolean(account.directory.archivedAt)} onClick={() => void manager.restoreAccount(account.id)}><RotateCw size={16} /></IconButton>
        <IconButton title={manager.t('delete')} danger onClick={() => void remove(account)}><Trash2 size={16} /></IconButton>
      </div>
    </li>)}</ul>
  </details>
}

function PlatformManagerSection(props: ManagerProps): ReactNode {
  const sectionRef = useRef<HTMLElement>(null)
  const snapshot = props.useDirectory(value => value)
  const [accountModal, setAccountModal] = useState<PublicPlatformAccount | null | undefined>(undefined)
  const [keepAliveAccount, setKeepAliveAccount] = useState<PublicPlatformAccount>()
  const [loginResult, setLoginResult] = useState<{ account: PublicPlatformAccount, result: LoginCheckResult }>()
  const [deleteDirectory, setDeleteDirectory] = useState<PublicBrowserDataDirectory>()
  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => {
    let ancestor = sectionRef.current?.parentElement
    while (ancestor && getComputedStyle(ancestor).position !== 'fixed') ancestor = ancestor.parentElement
    if (!ancestor) return
    ancestor.dataset.samSettingsOverlay = 'true'
    return () => { delete ancestor.dataset.samSettingsOverlay }
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => void props.refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [props.refresh])
  const filteredAccounts = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return snapshot.accounts
    return snapshot.accounts.filter(account => [account.id, account.platformName, account.name, account.profile.userIdentifier]
      .some(value => value.toLocaleLowerCase().includes(query)))
  }, [searchQuery, snapshot.accounts])
  const groups = useMemo(() => snapshot.directories.map(directory => ({
    directory,
    accounts: filteredAccounts.filter(account => account.browserDataDirectoryId === directory.id),
  })).filter(group => !searchQuery.trim() || group.accounts.length > 0), [filteredAccounts, searchQuery, snapshot.directories])
  const platformNames = useMemo(() => [...new Set([...snapshot.accounts, ...snapshot.archivedAccounts]
    .map(account => account.platformName))].sort((left, right) => left.localeCompare(right)), [snapshot.accounts, snapshot.archivedAccounts])
  const checkLogin = async (account: PublicPlatformAccount) => {
    try {
      const result = await props.checkLogin(account.id)
      if (result) setLoginResult({ account, result })
    } catch {
      // The shared error banner already contains the API failure.
    }
  }
  return <section ref={sectionRef} className="sam_section">
    <header className="sam_pageHeader">
      <div><h2>{props.t('title')}</h2><p>{props.t('subtitle')}</p></div>
      <button className="sam_primaryButton" type="button" onClick={() => setAccountModal(null)}><Plus size={16} />{props.t('add')}</button>
    </header>
    <div className="sam_notice"><Info size={16} /><span>{props.t('privacy')}</span></div>
    {snapshot.error && <div className="sam_error" role="alert"><CircleAlert size={16} /><span>{snapshot.error}</span></div>}
    <div className="sam_toolbar">
      <span>{interpolate(props.t('summary'), { accounts: snapshot.accounts.length, directories: snapshot.directories.length })}</span>
      <div className="sam_toolbarActions">
        <label className="sam_searchBox">
          <Search size={15} />
          <input type="search" aria-label={props.t('searchAccounts')} placeholder={props.t('searchAccounts')}
            value={searchQuery} onChange={event => setSearchQuery(event.target.value)} />
        </label>
        <IconButton title={props.t('refresh')} disabled={snapshot.loading || snapshot.busyKeys.length > 0} onClick={() => void props.refresh()}>
          <RefreshCw className={snapshot.loading ? 'sam_spinner' : undefined} size={16} />
        </IconButton>
      </div>
    </div>
    {!snapshot.loading && !snapshot.accounts.length && !snapshot.directories.length
      ? <div className="sam_empty"><HardDrive size={24} /><h3>{props.t('emptyTitle')}</h3><p>{props.t('emptyBody')}</p><button className="sam_secondaryButton" type="button" onClick={() => setAccountModal(null)}><Plus size={15} />{props.t('add')}</button></div>
      : groups.length ? <div className="sam_directoryList">{groups.map(group => <DirectoryGroup
          key={group.directory.id}
          directory={group.directory}
          accounts={group.accounts}
          manager={props}
          onEdit={account => setAccountModal(account)}
          onKeepAlive={setKeepAliveAccount}
          onCheckLogin={account => void checkLogin(account)}
        />)}</div> : <div className="sam_directoryEmpty sam_searchEmpty">{props.t('noSearchResults')}</div>}
    <ArchivedAccounts manager={props} accounts={snapshot.archivedAccounts} />
    <ArchivedDirectories manager={props} directories={snapshot.archivedDirectories} onDelete={setDeleteDirectory} />
    {accountModal !== undefined && <AccountModal
      account={accountModal || undefined}
      availableDirectories={snapshot.availableDirectories}
      accounts={snapshot.accounts}
      platformNames={platformNames}
      manager={props}
      onClose={() => setAccountModal(undefined)}
    />}
    {keepAliveAccount && <KeepAliveModal account={keepAliveAccount} manager={props} onClose={() => setKeepAliveAccount(undefined)} />}
    {loginResult && <LoginResultModal account={loginResult.account} result={loginResult.result} manager={props} onClose={() => setLoginResult(undefined)} />}
    {deleteDirectory && <DeleteDirectoryModal directory={deleteDirectory} manager={props} onClose={() => setDeleteDirectory(undefined)} />}
  </section>
}

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)?.remove()
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-platform-account-manager-plugin'
    style.dataset.pluginCss = STYLE_ID
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'platform-manager: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'platform-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  const directory = new PlatformDirectory()
  ctx.effect(() => () => directory.dispose(), 'platform-manager: directory')
  const accountKey = (id: string) => `account:${id}`
  const injected = () => ({
    hooks: { directory: directory.source },
    refresh: () => directory.refresh(),
    createAccount: (account: PlatformAccountInput, selection: BrowserDirectorySelection) => directory.mutate('account:create', 'create', { account, directory: selection }),
    updateAccount: (id: string, account: PlatformAccountInput) => directory.mutate(accountKey(id), 'update', { id, account }),
    archiveAccount: (id: string) => directory.mutate(accountKey(id), 'archive', { id }),
    restoreAccount: (id: string) => directory.mutate(accountKey(id), 'restore', { id }),
    deleteAccount: (id: string) => directory.mutate(accountKey(id), 'delete', { id }),
    openAccount: (id: string) => directory.mutate(accountKey(id), 'open', { id }),
    closeBrowser: (id: string) => directory.mutate(accountKey(id), 'close-browser', { id }),
    checkLogin: (id: string) => directory.mutate<LoginCheckResult>(accountKey(id), 'check-login', { id }),
    manualConfirmLogin: (id: string) => directory.mutate(accountKey(id), 'manual-confirm-login', { id }),
    setKeepAlive: (id: string, keepAlive: Partial<KeepAliveSettings>) => directory.mutate(accountKey(id), 'keep-alive-settings', { id, keepAlive }),
    runKeepAlive: (id: string) => directory.mutate(accountKey(id), 'keep-alive-now', { id }),
    syncCookies: (profileId: string) => directory.mutate(`profile:${profileId}`, 'sync-cookies', { profileId }),
    pickDirectory: async () => {
      const result = await directory.mutate<{ path: string | null }>('directory:picker', 'pick-directory')
      return result?.path || null
    },
    inspectDirectory: (browser: BrowserKind, path: string) => directory.mutate<DiscoveredBrowserDataDirectory>(
      'directory:inspect',
      'inspect-directory',
      { browser, path },
    ),
    scanComputer: () => directory.mutate('directory:scan', 'scan-computer'),
    revealDirectory: (directoryId: string) => directory.mutate(`directory:${directoryId}`, 'reveal-directory', { directoryId }),
    renameDirectory: (directoryId: string, name: string) => directory.mutate(`directory:${directoryId}`, 'rename-directory', { directoryId, name }),
    renameProfile: (profileId: string, userIdentifier: string) => directory.mutate(
      `profile:${profileId}`,
      'rename-profile',
      { profileId, userIdentifier },
    ),
    archiveDirectory: (directoryId: string) => directory.mutate(`directory:${directoryId}`, 'archive-directory', { directoryId }),
    restoreDirectory: (directoryId: string) => directory.mutate(`directory:${directoryId}`, 'restore-directory', { directoryId }),
    deleteDirectory: (directoryId: string, deleteLocalData: boolean, confirmationName?: string) => directory.mutate(
      `directory:${directoryId}`,
      'delete-directory',
      { directoryId, deleteLocalData, ...(confirmationName ? { confirmationName } : {}) },
    ),
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'platform-management',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, PlatformManagerSection))
}

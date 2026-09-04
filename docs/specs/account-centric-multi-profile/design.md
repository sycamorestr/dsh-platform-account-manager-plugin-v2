# 账号中心与同 Root 多 Profile：技术设计

## 1. 已验证的 Chromium 行为

2026-09-02 使用 Microsoft Edge 152 和 D 盘临时 Data Root 验证：

1. 同一 Root 的 `Profile 1`、`Profile 2` 可在同一浏览器主进程中同时打开。
2. 两个页面 Target 具有不同 `browserContextId`。
3. 普通磁盘 Profile 的 Context ID不能直接用于浏览器级 `Storage.getCookies/setCookies`。
4. 连接各 Profile 的页面 Target 后调用无 `browserContextId` 的 `Storage` 命令，可以读取和写入各自独立 Cookie Store。

因此 `browserContextId` 用于 Target 归属和激活，Cookie 操作使用该 Profile 的页面 Target WebSocket。

可复现脚本：`scripts/profile-context-spike.mjs`。

## 2. 数据模型 v5

```ts
interface BrowserProfile {
  id: string
  browserDataDirectoryId: string
  directoryName: string
  name: string
  userIdentifier: string
}

interface PlatformAccount {
  id: `ACC-${string}`
  name: string
  platformName: string
  browserDataDirectoryId: string
  browserProfileId: string
}

interface AccountDocument {
  version: 5
  nextAccountNumber: number
  browserDataDirectories: BrowserDataDirectory[]
  browserProfiles: BrowserProfile[]
  accounts: PlatformAccount[]
}
```

`accountLabel` 被删除。Profile 的 `name` 保留浏览器发现名称，`userIdentifier` 是用户可编辑别名。

账号 ID 从 `ACC-0001` 开始单调分配。`nextAccountNumber` 只增长；写入前仍检查冲突并继续递增。v4 账号按 `createdAt + id` 稳定排序后分配短 ID，原文件备份为 `accounts.v4.backup.json`。

## 3. 创建协议

现有 `existing/discovered/new` 三种存储路径保留，各选择增加 `profileUserIdentifier`：

- `new`：目录默认使用 `<browserDataRoot>/<accountId>`，Profile 物理目录为 `Default`。
- `existing`：登记或复用已存 Profile，并更新用户标识。
- `discovered`：同一次原子写入登记外部 Root、Profile 和账号。

账号 ID 必须在生成默认目录路径前分配，因此创建事务先保留 ID，再创建目录记录和账号记录。

## 4. 运行时 v3

```ts
interface ProfileRuntime {
  profileId: string
  profileDirectory: string
  profileName: string
  browserContextId: string
  lastTargetId?: string
}

interface RootRuntime {
  directoryId: string
  instanceId: string
  browser: BrowserKind
  path: string
  pid: number
  port: number
  startedAt: string
  profiles: ProfileRuntime[]
}

interface RuntimeDocument {
  version: 3
  runtimes: RootRuntime[]
}
```

内存以 `directoryId` 保存 RootRuntime，以 `profileId` 保存 ProfileRuntime。Profile 锁使用 `profileId`；Root 启动和关闭仍使用 `directoryId` 锁。

### 4.1 Profile 激活与上下文绑定

1. Root 离线时，以固定 CDP 端口、目标 `--profile-directory` 和唯一 marker URL 启动浏览器。
2. Root 在线时，再次调用浏览器可执行文件和目标 `--profile-directory`，由 Chromium 主进程打开 marker。
3. `Target.getTargets` 找到 marker Target，记录其 `browserContextId`。
4. 通过 marker 的页面 WebSocket 执行 `Page.navigate` 到业务 URL。
5. 后续 Target 通过 `browserContextId` 过滤，已有业务页面使用 `Target.activateTarget` 激活。

### 4.2 Cookie 与登录检测

从目标 Profile 选择一个页面 Target，连接其页面 WebSocket：

- `Storage.getCookies()` 获取该 Profile Cookie Store。
- `Storage.setCookies()` 持久化该 Profile 的会话 Cookie。
- 登录检测只观察同一 `browserContextId` 的目标页面。

### 4.3 关闭

关闭 Profile 会关闭其 Context 下的页面 Target并移除 ProfileRuntime。Root 内仍有其他受管 Profile 时保留主进程；最后一个 Profile 关闭后调用 `Browser.close`。

## 5. 公共状态与 Agent

目录状态将单个 `activeProfileId` 改为 `onlineProfileIds`。Profile 公共状态根据该集合计算。

Agent 列表返回短账号 ID、平台、账号名称和最小状态，不返回用户路径。所有账号工具按 `ACC-0001` ID 精确执行；名称查找只作为列表能力。

## 6. UI

平台管理以账号为主要扫描单位，每个账号直接展示：

- 账号 ID（可复制）
- 平台名称和账号名称
- Profile 用户标识和物理目录名
- Data Root 名称与完整路径
- 登录/Profile 在线状态
- 激活、检查、编辑、归档操作

新增表单移除 `accountLabel` 和内置平台预设，增加用户标识。Profile 候选采用可搜索原生输入建议，仍保持键盘可用性和移动端稳定布局。

## 7. 本机扫描

`BrowserDiscovery` 增加显式 `scanComputer()`：

- Windows 下枚举可访问固定盘符。
- 有界广度搜索 `Local State`，跳过系统、依赖、缓存和回收站目录。
- 候选通过现有 Profile 检查函数验证。
- 扫描结果缓存在服务进程中，并与标准/登记目录去重。

无法可靠判断自定义 Root 属于 Chrome 还是 Edge 时，基于路径推断并允许用户在登记前修改浏览器类型。

## 8. 回滚

- v5 写入前精确备份 v4。
- 运行时 v2 记录不恢复为在线状态，初始化时写成 v3 空记录。
- 回滚到 0.4.0 时恢复 `accounts.v4.backup.json` 和旧构建产物。
- 浏览器文件不参与迁移和回滚。

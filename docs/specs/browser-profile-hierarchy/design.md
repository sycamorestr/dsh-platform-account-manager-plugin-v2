# 浏览器用户目录分层：技术设计

## 1. 设计决策

采用 `Data Root → Browser Profile → Platform Account` 三层模型。Profile 是持久实体，账号通过 `browserProfileId` 绑定；`browserDataDirectoryId` 继续保留，便于校验、查询和兼容现有调用。

本期采用单根目录单活策略：一个 Data Root 同一时间最多有一个插件启动的 Profile。该约束避免在没有经过充分实机验证前，错误地把多个 Profile 的 CDP Target、Cookie 或关闭操作混在一起。

## 2. 数据模型 v4

```ts
interface BrowserProfile {
  id: string
  browserDataDirectoryId: string
  directoryName: string
  name: string
  origin: 'plugin-created' | 'discovered' | 'legacy'
  createdAt: string
  updatedAt: string
}

interface PlatformAccount {
  browserDataDirectoryId: string
  browserProfileId: string
}

interface AccountDocument {
  version: 4
  browserDataDirectories: BrowserDataDirectory[]
  browserProfiles: BrowserProfile[]
  accounts: PlatformAccount[]
}
```

不变量：

1. `(browserDataDirectoryId, normalized directoryName)` 唯一。
2. 每个 Profile 必须引用已存在的 Data Root。
3. 每个账号引用的 Data Root 和 Profile 所属 Data Root 必须一致。
4. Data Root 之间仍不得相同或互相嵌套。

## 3. 创建绑定协议

```ts
type BrowserBindingSelection =
  | { mode: 'existing'; directoryId: string; profileDirectory: string; profileName?: string }
  | { mode: 'discovered'; browser: BrowserKind; path: string; name?: string; profileDirectory: string; profileName?: string }
  | { mode: 'new'; directory?: NewBrowserDataDirectoryInput }
```

- `new`：创建插件目录或安全的空自定义目录，并创建 `Default` Profile 记录。
- `existing`：复用已登记 Data Root，绑定已存或刚发现的 Profile。
- `discovered`：在创建账号的同一次原子更新中登记外部 Data Root 和 Profile。

外部 Profile 必须通过磁盘检查：Profile 是 Data Root 的直接子目录，且包含 `Preferences`。插件新建空根目录的 `Default` 允许在首次浏览器启动前不存在。

## 4. 目录发现

新增 `BrowserDiscovery`：

1. 枚举当前用户标准 Chrome/Edge channel 根目录。
2. 合并所有已登记 Data Root。
3. 读取 `Local State.profile.info_cache` 获取 Profile 稳定目录名和显示名。
4. 在元数据不完整时，以 Data Root 直接子目录中的 `Preferences` 做只读回退。
5. 合并已经登记但尚未首次启动的 Profile。
6. 按浏览器类型和规范化绝对路径去重。

手动目录使用原生目录选择器，随后调用同一检查逻辑。未识别出正常 Profile 的外部目录不能作为复用目标。

发现 API 返回本机敏感路径，因此保持现有环回地址和 Origin 校验，不向 Agent 工具暴露。

## 5. 浏览器运行时

运行时文档升级为 v2：

```ts
interface BrowserRuntime {
  directoryId: string
  profileId: string
  profileDirectory: string
  // 其余 PID、port、instanceId 等字段不变
}
```

所有浏览器方法接收 `directory + profile`：

- `open`
- `platformStatus`
- `checkLogin`
- `persistSessionCookies`
- `trustedConnection`
- `isOnline`

启动参数追加 `--profile-directory=<profile.directoryName>`。如果健康运行时属于同 Data Root 的另一个 Profile，返回冲突错误，不自动关闭或切换。

Cookie 状态按 `profile.id` 存储。由于本期保证单活，浏览器级 `Storage.getCookies/setCookies` 只在当前 Profile 运行时执行；运行时和 Profile 不匹配时拒绝执行。

## 6. UI 与公共状态

公共状态增加：

- `profiles`、`archivedProfiles`
- `availableDirectories`：发现和已登记 Data Root 的合并清单，每项包含 Profile 候选
- 账号对象增加 `profile`
- 目录状态增加 `activeProfileId`

新增账号表单：

1. “新建数据根目录 / 复用已有数据根目录”切换。
2. 复用模式先选择 Data Root，再选择 Profile。
3. 提供“选择其他目录”按钮并用当前选择的浏览器类型检查。
4. 如果选中 Profile 已绑定相同站点域名的账号，显示非阻塞风险警告。

总览保持 Data Root 一级分组，在目录标题下增加 Profile 标识，并在账号行展示 Profile 名称。

## 7. 迁移

`init()` 将 v1/v2 先转换成既有 v3 形态，再统一执行 v3 → v4：

1. 写入对应原版本备份；v3 写入 `accounts.v3.backup.json`。
2. 为每个 Data Root 发现迁移 Profile：
   - 有 `Local State.profile.last_used` 且目录有效时使用它；
   - 否则唯一有效 Profile；
   - 否则 `Default`。
3. 同一 Data Root 的旧账号共享同一迁移 Profile。
4. 写入 v4，浏览器目录内容不变。

旧 v1/v2 精确备份继续保留；从旧版本直升时不额外伪造 `accounts.v3.backup.json`。

## 8. 安全与回滚

- 外部目录不写所有权 marker，不允许物理删除。
- Profile 删除不进入本期 API。
- 数据库写入继续使用临时文件加原子重命名。
- 发布前备份当前实际 `accounts.json`，即使自动迁移也可人工回滚元数据。
- 回滚代码前必须同时恢复 v3 备份，v3 代码不能读取 v4 文档。

## 9. 未来扩展

并行 Profile 模式需要新增并验证：

- `Target.getTargets` 到 `browserContextId` 的稳定映射；
- 按 BrowserContext 的 Cookie 同步；
- Profile 级关闭而非 `Browser.close`；
- 受信任连接的 Profile 范围授权；
- 根目录级进程调度器。

v4 Profile 实体和运行时字段已经为上述扩展预留身份边界。

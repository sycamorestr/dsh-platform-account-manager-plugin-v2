# 浏览器用户目录分层：需求规格

状态：已批准实施
目标版本：0.4.0
实施方案：分层安全版（同一浏览器数据根目录同时只允许一个受管 Profile 在线）

## 1. 背景

当前插件把 Chromium 的 `--user-data-dir` 作为账号的唯一浏览器身份边界，并默认使用浏览器选中的用户配置。真实的 Chrome/Edge 数据根目录通常同时包含 `Default`、`Profile 1`、`Profile 2` 等多个 Profile，因此仅绑定数据根目录无法稳定定位平台账号，也无法安全复用用户已有的浏览器身份。

## 2. 术语

- 浏览器数据根目录（Data Root）：传给 `--user-data-dir` 的目录，通常包含 `Local State` 和一个或多个 Profile。
- 浏览器用户配置（Profile）：Data Root 下的 `Default`、`Profile N` 等目录，传给 `--profile-directory`。
- 平台账号：插件中登记的平台业务账号，可以和其他不同平台账号共享同一个 Profile。
- 外部目录：浏览器或用户已有、插件不拥有其本机文件的 Data Root。
- 插件目录：由插件在 `browserDataRoot` 下创建并拥有的 Data Root。

## 3. 用户故事

### US-1 发现浏览器数据根目录

作为用户，我希望新增账号时看到当前 Windows 用户下可识别的 Chrome/Edge 数据根目录，以及插件已登记的目录，从而不必手工抄写路径。

验收标准：

1. 自动发现 Chrome、Edge 稳定版及常见 Beta/Dev/Canary 当前用户目录。
2. 合并插件已登记目录并去重。
3. 支持通过系统目录选择器检查一个额外目录。
4. 不默认递归扫描整块磁盘。
5. 外部目录只能登记或取消登记，插件不得物理删除。

### US-2 联动选择 Profile

作为用户，我希望选择 Data Root 后看到其中所有正常 Profile，以便把平台账号绑定到正确身份。

验收标准：

1. Profile 下拉框随 Data Root 选择联动刷新。
2. 同时显示稳定目录名（如 `Profile 12`）和用户可读名称。
3. 排除 `Guest Profile`、`System Profile`、备份和明显临时目录。
4. Profile 目录必须存在且包含 `Preferences`；插件新建空 Data Root 的 `Default` 例外。
5. 同一个 Profile 可以被多个不同平台账号复用。

### US-3 稳定启动指定 Profile

作为用户，我希望打开账号时始终进入其绑定的 Profile，避免串号。

验收标准：

1. 启动参数同时包含 `--user-data-dir` 和 `--profile-directory`。
2. 运行时记录 Data Root 和 Profile 身份。
3. 同一 Data Root 已有另一个受管 Profile 在线时，拒绝隐式切换并给出明确错误。
4. 登录检测、Cookie 同步、状态查询和受信任连接只能作用于当前绑定 Profile。

### US-4 安全迁移

作为现有用户，我希望升级后账号和浏览器资料保持原位且尽可能继续工作。

验收标准：

1. 元数据从 v3 原地迁移到 v4，迁移前逐字节备份为 `accounts.v3.backup.json`。
2. 插件创建目录和单 Profile 目录自动绑定其唯一 Profile。
3. 多 Profile 外部目录优先使用 `Local State.profile.last_used`；无法确认时使用 `Default` 并在元数据中保留明确绑定。
4. 迁移不移动、复制、删除或修改浏览器资料。
5. v1/v2 可继续通过既有迁移链升级到 v4。

### US-5 分层状态展示

作为用户，我希望在管理页看到 Data Root → Profile → 平台账号的关系以及占用状态。

验收标准：

1. 账号展示所绑定 Profile 的名称和目录名。
2. Data Root 状态包含当前在线 Profile。
3. 创建表单对同 Profile、同站点域名的复用给出串号风险提示。
4. “关闭浏览器”明确说明会关闭该 Data Root 的整个浏览器进程。

## 4. 非功能需求

- 隐私：发现结果只通过环回 API 返回本机设置 UI，不进入 Agent 工具输出。
- 完整性：只读解析 `Local State` 和 `Preferences`，不得修改外部浏览器文件。
- 性能：标准目录发现应在普通本机上秒级完成；失败目录不得阻塞其余发现结果。
- 兼容性：Windows 为本期完整支持平台；非 Windows 保留已登记目录和手动选择能力。
- 可测试性：迁移、发现、选择校验、启动参数和单活约束必须有自动化测试。

## 5. 明确不做

- 不全盘无边界扫描任意 `Local State` 文件。
- 不删除单个外部 Profile。
- 不在本期实现同一 Data Root 下多个 Profile 的并行 CDP 管理。
- 不接管未启用 CDP 且已由普通浏览器占用的进程。
- 不复制 Profile 到 D 盘，不修改 Cookie 加密材料。

## 6. 完成定义

- 本目录中的技术设计和任务清单与实现一致。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- 在当前 DSH Web Profile 中完成重启部署。
- 实机 API 能发现 Chrome/Edge Profile，新增账号界面能够完成根目录与 Profile 联动选择。
- README 更新为 v0.4.0 行为和迁移说明。

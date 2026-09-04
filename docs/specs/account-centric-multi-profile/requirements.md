# 账号中心与同 Root 多 Profile：需求规格

状态：已批准实施
目标版本：0.5.0
前置版本：0.4.0 浏览器 Profile 分层

## 1. 目标

平台账号是用户和 Agent 的唯一操作入口。每个账号具有短、稳定、可见的账号 ID，并精确绑定一个 Chromium Data Root 和一个 Profile。同一 Data Root 下多个 Profile 可以同时打开，互不阻塞。

## 2. 核心关系

```text
Account ID
└── Platform Account
    └── Browser Profile
        └── Browser Data Root
```

账号 ID 采用 `ACC-0001` 格式，创建后不改变，删除后不复用。Data Root 和 Profile 继续使用内部 UUID。

## 3. 用户故事与验收标准

### US-1 通过可见 ID 精确打开账号

1. 平台管理页直接展示账号 ID、平台名称、账号名称、用户标识和完整浏览器绑定。
2. Agent 工具接受账号 ID；用户说“进入 ACC-0001 的店铺”时无需先按名称模糊匹配。
3. 编辑名称、平台或用户标识不改变账号 ID。
4. 删除账号后该 ID 不得分配给新账号。
5. 移除原“账号标识（可选）”字段。

### US-2 同 Root 多 Profile 并行

1. 同一 Data Root 下至少两个 Profile 可以同时由插件打开。
2. 打开已在线 Profile 时优先激活已有目标页面，不重复创建。
3. 打开未在线 Profile 时通过 `--profile-directory` 激活该用户，不关闭其他 Profile。
4. 运行时锁以 Profile 为粒度；不同 Profile 可以并行。
5. 关闭账号浏览器只关闭其 Profile 页面；只有该 Root 没有其他受管 Profile 时才关闭整个浏览器进程。

### US-3 Profile 级登录与 Cookie

1. 页面、登录检测和 Cookie 必须限定到账号绑定的 Profile Target 会话。
2. 同 Root 不同 Profile 的登录状态和 Cookie 不得串用。
3. 新建目录和可管理的复用目录使用同一 Cookie 持久化逻辑。
4. 外部浏览器已占用且无法建立 CDP 时返回明确能力错误，不声称已同步。

### US-4 简化新增账号

1. 核心字段为平台名称、账号名称、绑定模式、Data Root、Profile 和用户标识。
2. 后台地址、登录地址和 Agent 说明保留，但属于次要配置。
3. 新建环境默认保存到配置的 `browserDataRoot\<account-id>`。
4. 新建环境允许填写用户标识；物理 Profile 目录由系统管理。
5. 复用环境先选 Data Root，再选 Profile，并允许覆盖自动识别的用户标识。

### US-5 平台名称来源

1. 不提供内置平台预设。
2. 下拉建议仅来自用户已经创建或归档的账号平台名称。
3. 始终允许输入新的平台名称。

### US-6 发现其他浏览器目录

1. 保留标准目录、已登记目录和手动选择目录发现。
2. 增加手动触发的本机扫描，查找包含 `Local State` 和有效 Profile `Preferences` 的目录。
3. 扫描失败、无权限目录或损坏配置不得阻塞其他结果。
4. 扫描结果去重并缓存；不得在每次打开弹窗时自动全盘扫描。
5. 外部目录仍只能解除登记，不能由插件物理删除。

## 4. 非功能需求

- 隐私：本机路径、Profile 名称、Cookie 和 CDP endpoint 不进入 Agent 输出。
- 安全：短 ID 不是安全凭证；API 继续仅接受环回请求和可信 Origin。
- 性能：标准发现秒级完成；本机扫描显式触发并有目录数量与深度边界。
- 兼容：v4 原文件精确备份后迁移到 v5；浏览器资料不移动、不复制、不删除。
- 可测试：ID 分配、迁移、多 Profile Target 隔离、Cookie 隔离、动态平台名称和 UI 表面有自动化测试。

## 5. 本期不做

- 操作审计记录和撤销历史。
- 第二套对用户隐藏的账号 UUID。
- 可选账号标识字段。
- 平台模板管理。
- 默认安装浏览器扩展；仅当目标 Chromium 无法稳定提供 Profile Target 时作为后续兼容方案。

## 6. 完成定义

- 本目录的设计、任务、测试和验收记录与实现一致。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- 临时 D 盘 Data Root 实机验证同 Root 双 Profile、精确激活和 Cookie 隔离。
- Playwright 验证新增流程和平台管理列表的桌面、移动布局。
- DSH 重启后 API、日志、v5 数据和 v3 运行时登记正常。

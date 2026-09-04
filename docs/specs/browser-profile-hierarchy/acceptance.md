# 浏览器用户目录分层：验收记录

## 1. 验收结论

本次实现满足 `requirements.md`、`design.md` 和 `test-plan.md` 定义的核心范围，可部署使用。

已落地的身份层级为：

```text
Browser Data Root
└── Browser Profile（Default / Profile N）
    └── Platform Account
```

运行时采用同一 Data Root 单 Profile 在线约束。若另一个 Profile 已在线，打开、登录检查、Cookie 同步和受信任连接均不会复用错误 Profile，也不会关闭已在线的另一个 Profile。

## 2. 自动化验证

2026-09-02 在 Windows 本机执行：

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

结果：

- TypeScript 类型检查通过。
- 29 项自动化测试全部通过，0 失败、0 跳过。
- 服务端与客户端构建通过。
- 覆盖 v1/v2/v3 到 v4 迁移、v3 精确备份、目录发现、外部目录只读登记、Profile 启动参数、跨 Profile 冲突保护和跨 Profile 防误关。

## 3. 实机与 UI 验收

- DSH 插件成功启动，管理页可正常加载。
- 环回 API 返回 2 个可用 Data Root、共 52 个 Profile。
- Google Chrome：2 个 Profile。
- Microsoft Edge：50 个 Profile。
- 新增账号弹窗中 Data Root 与 Profile 下拉框联动正常。
- 切换到 Edge Data Root 后可显示该目录下的 Profile 名称及 `Profile N` 目录名。
- 新建 Data Root 模式切换正常。
- 桌面视口和 390 × 844 移动视口无控件或文字重叠。
- 浏览器控制台 0 warning、0 error。

验收截图：

- `output/playwright/profile-selector-desktop.png`
- `output/playwright/profile-selector-mobile.png`

## 4. 数据与安全边界

- 实际 `accounts.json` 已迁移为 v4。
- 实际运行时登记文件已迁移为 v2。
- 当前实际数据为 0 个已登记 Data Root、0 个已登记 Profile、0 个平台账号。
- 验收未提交新增账号表单，也未启动或修改任何真实 Chrome/Edge Profile。
- 发现与手动检查只读取 `Local State`、Profile `Preferences` 和目录元数据。
- 外部 Data Root 始终不可由插件物理删除。

部署前备份：

- `<dataDir>\accounts.pre-v4.<timestamp>.json`
- `<dataDir>\accounts.v3.backup.json`

## 5. 已知约束

Chromium 的 Data Root 由单个浏览器主进程管理，因此当前版本不允许同一 Data Root 下多个 Profile 同时由插件启动。需要切换 Profile 时，先关闭该 Data Root 当前在线的浏览器实例。

真实平台的密码、验证码及登录态有效性未在验收中读取或提交，首次账号绑定后的登录确认由用户在对应浏览器窗口中完成。

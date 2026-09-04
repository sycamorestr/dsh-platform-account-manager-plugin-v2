# 账号中心与同 Root 多 Profile：验收记录

## 1. 验收结论

版本 `0.5.0` 已按本目录需求、设计和测试方案完成开发并部署到本机 DSH。账号现以 `ACC-0001` 形式作为用户与 Agent 的稳定入口，每个账号精确绑定 Data Root 和 Profile；同 Root 多 Profile 可同时在线。

## 2. 自动化验证

2026-09-02 在 Windows 本机执行：

```powershell
corepack pnpm verify
git diff --check
```

结果：

- TypeScript 类型检查通过。
- 33 项自动化测试全部通过，0 失败、0 跳过。
- 服务端与客户端构建通过。
- diff whitespace 检查通过。
- 测试覆盖 v1-v4 到 v5 迁移、短 ID 单调分配、Profile 用户标识、双 Profile 并发、Profile Target Cookie、Profile 级关闭、本机有界扫描和 UI 表面。

## 3. Chromium 实机验收

使用隔离的临时 Data Root 和 Microsoft Edge 验证：

- 同一 Root 的两个 Profile 同时在线且具有不同 `browserContextId`。
- 连接各自页面 Target 执行 `Storage.getCookies/setCookies` 时，同名 Cookie 保持 Profile 隔离。
- `BrowserManager` 同时登记两个 Profile；关闭第一个后第二个仍在线；最后一个 Profile 关闭后 Root 才退出。
- 实机发现 `about:blank#marker` 会被 Edge 归一化；后续又验证独立 `.invalid` marker 在 Data Root 被普通浏览器占用时会泄露给用户。现改为在真实平台 URL fragment 中附加一次性 marker，CDP 成功后恢复原 URL，失败时也不会离开配置的平台地址，并已复验通过。

可复现脚本：

- `scripts/profile-context-spike.mjs`
- `scripts/browser-manager-multi-profile-smoke.ts`

## 4. 数据迁移与部署

- DSH 重启并加载最终构建，Web UI 与插件 API 正常响应。
- 验收副本中的 `accounts.json` 已迁移为 v5，账号获得稳定短 ID。
- 验收副本中的 `browser-runtime.json` 已升级为 v3。
- 迁移后的 Profile 获得初始用户标识，原 `accountLabel` 已从 v5 元数据移除。
- 没有移动、复制、删除或改写真实 Edge Profile。

备份：

- `<dataDir>\accounts.v4.backup.json`
- `<dataDir>\accounts.pre-v5.<timestamp>.json`
- 迁移前备份与原始文件逐字节一致。

## 5. UI 验收

Playwright CLI 验证了平台管理列表、新增账号、搜索和 Root/Profile 联动：

- 页面直接显示 `ACC-0001`、平台、账号名称、用户标识、Profile 目录和完整 Data Root/Profile 路径。
- 搜索可按 ID 命中；无结果状态正确。
- 平台候选仅来自验收数据中已有的平台，输入框仍可自由输入。
- 新增流程顺序为账号信息、Root/Profile 绑定、用户标识、次要 URL 和 Agent 信息。
- 桌面和 390 × 844 视口均无横向或元素几何溢出。
- 浏览器控制台 0 warning、0 error。

截图：

- `output/playwright/account-manager-v5-desktop.png`
- `output/playwright/account-manager-v5-mobile.png`
- `output/playwright/account-create-v5-desktop.png`
- `output/playwright/account-create-v5-mobile.png`

## 6. 边界

- 外部 Data Root 仍只允许解除登记，插件不会物理删除。
- Cookie 持久化只改变 Chromium 本地 Cookie 属性，不能延长平台服务端会话。
- 用户日常浏览器已经以不兼容参数占用 Root 时，插件会报告 CDP 能力错误，不声称同步成功。
- 临时 smoke/spike Root 与正式数据隔离；脚本支持通过 `DSH_SMOKE_ROOT` 指定测试目录。

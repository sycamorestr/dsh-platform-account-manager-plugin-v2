# 账号中心与同 Root 多 Profile：测试方案

## 1. 自动化测试

### 数据与迁移

- 空安装创建 v5 文档，`nextAccountNumber` 从 1 开始。
- 创建账号得到 `ACC-0001`，后续账号递增，归档或删除不复用 ID。
- v4 原文精确备份为 `accounts.v4.backup.json`，账号稳定迁移为短 ID。
- Profile 获得非空用户标识，账号不再包含 `accountLabel`。
- Root、Profile、账号引用不变量继续生效。

### 运行时

- 启动参数包含 Data Root、Profile 和固定 CDP 端口。
- 同 Root 第二 Profile 不触发冲突错误。
- marker Target 正确绑定 `browserContextId`。
- Target 过滤、平台状态和激活限定到目标 Profile。
- Cookie 通过目标 Profile 页面 Target 执行。
- 关闭一个 Profile 不关闭同 Root 其他 Profile。
- v2 运行时安全升级为 v3。

### API/Agent/UI

- API 接受并返回 `ACC-0001`，拒绝无效 ID。
- Agent 摘要返回可见 ID但不返回路径、Cookie 或 endpoint。
- 平台建议只来自用户账号，不包含内置预设。
- 客户端包含用户标识、账号 ID、绑定路径和本机扫描入口。

## 2. 实机验收

1. 临时 D 盘 Root 同时打开 `Profile 1` 和 `Profile 2`。
2. 两个 Profile 页面 Target 的 `browserContextId` 不同。
3. 两个 Target Cookie Store 写入同名不同值后各自读取正确值。
4. 平台页面点击两个账号时能分别激活对应 Profile。
5. 关闭其中一个 Profile 后另一个保持在线。
6. 不读取或修改用户真实浏览器 Profile。

## 3. UI 验收

- 新增账号无账号标识字段，有用户标识字段。
- 平台名称建议来自已有数据且允许自由输入。
- 复用目录时 Root/Profile 联动和搜索正常。
- 平台管理页直接展示 ID、平台、账号、用户标识和绑定路径。
- 390 × 844 与桌面视口无重叠、截断或布局跳动。
- 浏览器控制台无 warning/error。

## 4. 发布门禁

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

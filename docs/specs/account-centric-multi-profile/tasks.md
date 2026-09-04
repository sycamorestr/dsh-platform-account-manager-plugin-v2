# 账号中心与同 Root 多 Profile：实施任务

## 规格与验证

- [x] 固化需求范围和不做项。
- [x] 使用临时 D 盘 Root 验证 Edge 双 Profile Target/Context。
- [x] 验证 Profile 页面 Target Cookie Store 隔离。

## 数据与迁移

- [x] 增加 v5 模型、短账号 ID 和 `nextAccountNumber`。
- [x] 增加 Profile 用户标识并删除账号标识。
- [x] 实现 v4 → v5 精确备份与迁移。
- [x] 更新 ID/API/Agent 校验和测试。

## 运行时

- [x] 将运行时升级为 RootRuntime + ProfileRuntime v3。
- [x] 实现 marker Target 与 Profile Context 映射。
- [x] 实现同 Root 多 Profile 打开和激活。
- [x] 将状态、登录、Cookie 和锁限定到 Profile Target。
- [x] 实现 Profile 级关闭和 Root 生命周期管理。

## 发现与 UI

- [x] 实现显式本机有界扫描和结果缓存。
- [x] 平台名称改为纯用户历史数据。
- [x] 简化新增表单并增加用户标识。
- [x] 平台管理直接展示账号 ID 和完整绑定。
- [x] 增加 ID、平台、账号、用户标识搜索。

## 验证与部署

- [x] 更新 README、版本号和发布说明。
- [x] 增加 v5、并行 Profile、Cookie 隔离和 UI 测试。
- [x] 运行 typecheck、test、build、diff check。
- [x] Playwright 验证桌面和移动端。
- [x] 备份、重启 DSH 并记录验收结果。

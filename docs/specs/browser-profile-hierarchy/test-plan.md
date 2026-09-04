# 浏览器用户目录分层：测试与发布方案

## 1. 自动化测试

### 存储与迁移

- 空安装创建 v4 文档。
- v3 精确备份并迁移到 v4。
- v1/v2 继续迁移，原备份保持逐字节一致。
- 多账号共享 Data Root 时复用同一迁移 Profile。
- 账号引用未知 Profile、跨 Data Root Profile、重复 Profile 目录时拒绝读取。
- new/existing/discovered 三种创建路径。
- 外部目录非空可登记但不可删除；新建自定义目录仍要求为空。

### 目录发现

- 从 `Local State.profile.info_cache` 发现并命名 Profile。
- `Preferences` 回退发现。
- 排除 Guest/System/备份目录。
- 标准目录、已登记目录和手动目录去重。
- 损坏 JSON、无权限或目录消失时局部失败不影响其他候选。

### 浏览器运行时

- 启动参数包含正确的 Data Root 和 Profile。
- 旧运行时记录安全忽略。
- 同 Data Root 同 Profile复用运行时。
- 同 Data Root 不同 Profile 被拒绝。
- Cookie、状态和连接在 Profile 不匹配时不执行。

### API/UI 表面

- 环回 API 返回 Profile 和 availableDirectories。
- Agent 输出仍不包含路径、Profile 目录名、Cookie 或 CDP endpoint。
- 客户端构建包含联动选择和风险提示文案。

## 2. 实机验收

1. DSH 重启后插件加载且服务日志无错误。
2. 管理页能发现本机标准 Chrome 和 Edge Data Root。
3. 选择 Edge Data Root 后 Profile 下拉显示多个用户配置且排除 Guest/System。
4. 手动选择一个 Data Root 后可读取 Profile。
5. 创建测试账号后 `accounts.json` 同时记录 Data Root 和 Profile 绑定。
6. 打开账号时进程命令行包含正确 `--profile-directory`。
7. 另一个 Profile 在线时，打开同根目录账号得到明确冲突提示。
8. 删除测试账号仅删除插件元数据，不删除外部浏览器资料。

涉及真实平台登录的验证由用户在浏览器中完成；测试过程不读取密码、验证码或 Cookie 值。

## 3. 发布门禁

```powershell
pnpm typecheck
pnpm test
pnpm build
```

三项全部通过后：

1. 复制实际 `accounts.json` 为带时间戳的部署前备份。
2. 停止 DSH。
3. 确认构建产物已更新。
4. 启动 DSH，检查状态与 stderr。
5. 调用环回 API确认 v4 状态和发现结果。

## 4. 回滚

1. 停止 DSH。
2. 恢复部署前插件代码或构建产物。
3. 用 `accounts.v3.backup.json` 或部署前备份恢复 `accounts.json`。
4. 删除 v4 运行时登记文件仅会丢失在线状态，不会删除浏览器资料。
5. 重新启动并检查状态。

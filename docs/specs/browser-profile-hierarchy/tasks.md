# 浏览器用户目录分层：实施任务

## 规格与模型

- [x] 固化需求、边界和验收标准。
- [x] 固化 v4 数据模型、运行时约束和迁移策略。
- [x] 增加共享类型和 v4 文档不变量。
- [x] 实现 v1/v2/v3 → v4 迁移与备份。

## 发现与存储

- [x] 实现 Chrome/Edge 标准根目录发现。
- [x] 实现 `Local State`/`Preferences` Profile 只读解析和过滤。
- [x] 实现手动目录检查 API。
- [x] 实现 external/new/existing 三种绑定创建路径。
- [x] 保持外部目录禁止物理删除。

## 浏览器运行时

- [x] 启动参数加入 `--profile-directory`。
- [x] 运行时登记升级并绑定 Profile。
- [x] 实现同 Data Root 不同 Profile 单活冲突保护。
- [x] 将状态、Cookie、登录检测和受信任连接限定到 Profile。
- [x] 调整保活分组和 Agent/Service 调用链。

## UI

- [x] 增加可用 Data Root 清单和联动 Profile 下拉框。
- [x] 增加手动检查目录入口。
- [x] 展示 Profile 身份、绑定数和同域复用风险。
- [x] 更新中英文文案、分层状态和关闭提示。

## 验证与交付

- [x] 增加迁移、发现、存储和运行时单元测试。
- [x] 更新 README、版本号和发布说明。
- [x] 运行 typecheck、test、build。
- [x] 备份实际数据、重启 DSH 并验证实机发现结果。
- [x] 对照需求验收并记录结果。

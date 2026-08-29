# DSH 平台账号管理器插件

[![CI](https://github.com/sycamorestr/dsh-platform-account-manager-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/sycamorestr/dsh-platform-account-manager-plugin/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/sycamorestr/dsh-platform-account-manager-plugin)](https://github.com/sycamorestr/dsh-platform-account-manager-plugin/releases)
[![License](https://img.shields.io/github/license/sycamorestr/dsh-platform-account-manager-plugin)](LICENSE)

> 让 Agent 知道“要用哪个账号、从哪个浏览器数据目录进入哪个平台”，并在浏览器重启后尽可能延续原有登录态。

这是一个面向 DeepSeek Harness（DSH）的本地优先平台账号与浏览器会话管理插件。它不是代替人登录的密码管理器，也不是负责点击和填写网页的自动化工具；它是 Agent 与真实业务后台之间的**账号目录、会话容器和浏览器生命周期层**。

> 当前版本：`0.3.1`

## 这个插件到底做什么

很多 Agent 可以操作浏览器，却缺少一个稳定的答案：

```text
“打开店铺后台”到底应该打开哪个平台、使用哪个账号、复用哪一份登录状态？
```

本插件为这个问题建立一条明确映射：

```text
平台名称 + 账号名称
        ↓
后台地址 / 登录地址
        ↓
指定的 Chrome 或 Edge 浏览器数据目录
        ↓
Cookie、Local Storage、IndexedDB 与其他站点状态
```

用户通常只需完成一次人工登录。此后，插件会继续使用同一个浏览器数据目录，并把可安全处理的会话 Cookie 交给 Chromium 持久化。DSH Agent 可以按平台名称和账号名称找到目标，打开后台、检查登录态，并在关闭浏览器前同步 Cookie。

它主要解决七个现实问题：

1. **浏览器关闭后又回到登录页**：临时浏览器上下文结束后，登录状态无法复用。
2. **Agent 不知道该使用哪个账号**：业务名称、后台地址和浏览器身份之间没有稳定映射。
3. **多账号容易串号**：不同账号共用默认浏览器环境，Cookie 和站点存储互相影响。
4. **浏览器数据难以管理**：不知道账号实际使用哪个磁盘目录，也无法可靠归档和清理。
5. **系统盘持续增长**：不能为业务账号选择独立的非系统盘数据目录。
6. **登录失效发现得太晚**：只有执行业务任务时才发现平台要求重新登录。
7. **账号管理与网页自动化混在一起**：权限范围过大，难以复用，也难以审计。

## 灵感来源：Accio Work

本项目的产品灵感来自阿里巴巴国际旗下 **[Accio Work](https://seller.alibaba.com/pages/accio_work)** 对“Agent 连接真实业务系统”的处理方式。

Accio Work 的官方介绍把它定位为本地优先、面向执行的 Agent 平台：Agent 不只给出文字答案，还可以使用本地文件、终端、浏览器和外部 API。官方同时强调“一台工作站管理多个电商后台”，以及让 Agent 使用已经登录的真实浏览器会话完成店铺运营任务。

Accio Work 的[浏览器使用指南](https://zh.accio.com/wow/doc-browser-use-guide.html)进一步描述了这套体验：Agent 连接用户日常使用且已经登录的 Chrome，从而减少重复登录，并保留真实设备、本地网络和完整页面交互能力；连接方式包括推荐的浏览器扩展和测试阶段的直连 CDP。其[插件说明](https://www.accio-ai.com/work/doc?slug=help-plugins)则把插件定义为连接器、技能和操作指令的组合，让 Agent 获得连接外部应用和执行专业任务所需的工具与权限。

本项目借鉴的不是 Accio Work 的代码或私有接口，而是其中一个非常重要的产品抽象：

> **不要让 Agent 每次从登录页重新开始，而要把已经授权的业务账号作为可识别、可复用、可管理的能力提供给 Agent。**

本项目与阿里巴巴或 Accio Work 没有隶属、授权、合作或兼容关系，是基于 DSH 插件体系独立开发的 MIT 开源实现。

## 与 Accio Work 的差异

Accio Work 是完整的商业 Agent 平台，本项目只是 DSH 中的账号和浏览器会话基础设施。两者解决的问题有交集，但产品边界和技术取舍不同。

| 维度 | Accio Work | DSH 平台账号管理器 |
| --- | --- | --- |
| 产品定位 | 集 Agent、插件、连接器、自动化和浏览器操作于一体的平台 | 可嵌入 DSH 的账号与会话管理插件 |
| 浏览器接入 | 优先通过扩展连接用户正在使用的浏览器，也提供直连 CDP | 为账号启动受管 Chrome/Edge，并绑定明确的浏览器数据目录 |
| 账号模型 | 通过平台连接器和应用授权管理多账号 | 任意平台名称 + 账号名称 + 后台/登录地址，平台不受固定枚举限制 |
| 隔离方式 | 连接器侧多账号与数据隔离 | 直接把 Chromium 浏览器数据目录作为身份边界，可独立也可共享 |
| 登录状态 | 复用浏览器已有会话或平台连接器授权 | 复用完整浏览器数据目录，并额外持久化可处理的会话 Cookie |
| 页面操作 | 平台内置导航、读取、点击、输入和完整工作流 | 明确不做通用页面操作，只提供打开、检测和关闭等会话能力 |
| 扩展方式 | 通过 Agent、Plugin、Connector 和 Skill 生态扩展 | 通过 `ctx.platformSessions` 向独立的 DSH 浏览器操作插件提供连接 |
| 发布形态 | Accio Work 产品能力 | 完整源码、测试、CI 和 MIT License |

这里的差异不表示哪种方案绝对更好。Accio Work 的扩展连接更适合直接接管用户日常浏览器；本项目的受管数据目录方案更适合需要明确账号映射、隔离、归档和可预测生命周期的 DSH 工作流。

## 针对 DSH 做出的强化

本项目不是把“打开一个带 Cookie 的浏览器”简单封装成按钮，而是针对长期运行的 Agent 场景补齐了账号生命周期：

- **明确的数据目录所有权**：每个账号都指向已登记的浏览器数据目录，目录来源分为插件创建、自定义和旧版迁移。
- **隔离与资源复用可选**：同平台多账号可以独立隔离，可信的不同平台可以共享一个浏览器进程。
- **数据位置可控**：新建账号时可以把浏览器数据放到非系统盘，不强制堆积在默认用户目录。
- **会话 Cookie 持久化**：只处理可安全复制的会话 Cookie，由 Chromium 写回原目录，不把 Cookie 导出到账号元数据。
- **登录状态可见**：支持随时检测，也可以由 Agent 在任务前确认登录是否仍有效。
- **经过实测的 CDP 启动策略**：不使用 `--remote-debugging-port=0`，不添加 `--enable-automation`，采用仅监听环回地址的运行时固定非零端口。
- **最小 Agent 权限面**：Agent 看不到 Cookie、密码、浏览器数据目录和 CDP endpoint。
- **危险删除需要证明所有权**：只有插件创建且通过多重校验的目录才允许物理删除，自定义目录永远只取消登记。
- **迁移不搬浏览器数据**：v1/v2 升级只迁移元数据并保留原目录，降低 Cookie 数据库损坏和串号风险。
- **为后续自动化插件留出接口**：页面操作由独立插件实现，账号管理器只提供受信任会话连接。

## 一次登录，后续复用

典型使用流程：

1. 在“平台管理”中创建账号，填写平台名称、账号名称和后台地址。
2. 为账号创建独立浏览器数据目录，或复用一个可信的已有目录。
3. 打开平台，在插件启动的 Chrome/Edge 中人工完成登录、扫码或多因素验证。
4. 点击“检测登录状态”，确认后台可以正常进入。
5. 后续直接让 Agent 打开该平台账号，插件会复用同一个浏览器数据目录。
6. 浏览器关闭前同步会话 Cookie；再次启动时由 Chromium 恢复本地状态。

这不是“永久免登录”。插件只能延续本机能够保存的浏览器状态，不能延长平台服务端 token，也不能绕过验证码、设备验证、异地登录失效或平台风控。

## 界面与操作流程

以下截图来自插件在 DSH 中实际运行的界面。为保护隐私，店铺名、账号名、平台域名和本机浏览器数据目录均已使用不可逆马赛克遮挡；截图没有使用真实账号密码，也没有公开 Cookie、CDP 端口或浏览器内部标识。

### 1. 平台管理总览

![平台管理总览](docs/images/platform-manager-overview.png)

- 浏览器数据目录是一级分组。同一个目录中的账号共享 Chromium 进程、Cookie 和站点存储；需要隔离的账号应使用不同目录。
- 目录标题区展示浏览器类型、在线状态、活动/归档账号数、页面数和最近一次 Cookie 同步状态。
- 目录右侧操作依次用于复制目录地址、在资源管理器中打开、重命名、同步 Cookie，以及满足条件后归档目录。
- 账号行展示平台、后台域名、浏览器是否在线、最近检测时间和登录结论；右侧可以打开平台、检测登录状态、配置保活、编辑或归档。
- “新增账号”是主要入口；“刷新状态”只重新读取浏览器与页面状态，不会打开平台或执行页面操作。

### 2. 新增账号并复用已有目录

![新增账号并复用已有目录](docs/images/add-account-existing-directory.png)

- 平台名称可以自由输入，因此不局限于电商，也可以登记广告、内容、客服、ERP 或其他企业后台。
- 账号名称用于用户和 Agent 识别目标账号；账号标识只供人工备注，不作为 Agent 识别或权限控制字段。
- 平台后台地址用于日常打开和登录检测，登录地址用于判断页面是否被重定向回登录入口，二者至少填写一个。
- “Agent 操作说明”提供账号用途、业务范围和注意事项等上下文，不会授予额外权限。
- 选择“复用已有目录”时，新账号与目标目录中的其他账号共享全部浏览器状态，适合彼此信任的不同平台；不建议用于需要隔离的同平台多账号。

### 3. 新增独立浏览器数据目录

![新增独立浏览器数据目录](docs/images/add-account-new-directory.png)

- 选择“新建数据目录”后，可以为目录命名并指定 Google Chrome 或 Microsoft Edge。
- 自定义目录地址是可选项。留空时使用插件配置的 `browserDataRoot`；指定地址时必须选择一个安全的空目录。
- 目录可以放在非系统盘，方便控制磁盘占用、备份策略和账号资料的物理位置。
- 创建后浏览器类型和目录绑定不可更换。这个限制用于避免跨目录搬运 Cookie 数据库造成损坏或账号串用。

### 4. 编辑账号

![编辑账号](docs/images/edit-account.png)

- 可以更新平台名称、账号名称、标识、后台/登录地址和 Agent 操作说明。
- 底部只读区域明确显示账号当前绑定的浏览器数据目录；编辑账号不会移动目录，也不会复制浏览器数据。
- 保存只修改账号元数据，不读取账号密码，不导出 Cookie，也不会自动登录平台。

### 5. 检测登录状态

![登录状态检测结果](docs/images/login-check-result.png)

- 点击账号行的盾牌按钮后，插件访问配置的后台地址并观察最终跳转，不读取页面正文、不点击控件、不输入账号密码。
- 结果弹窗给出 `登录有效`、`登录失效`、`无法判断` 或 `检测失败`，同时显示检测说明、最终地址和检测时间。
- 截图中的真实检测成功进入后台，没有再出现 `about:blank` 空白页；离线浏览器会直接从后台地址启动，在线浏览器则使用临时检测标签。
- 只有通用规则无法判断或检测失败时才提供人工确认入口；明确有效或失效的结果由检测自动更新。

### 6. 定时会话保活

![定时会话保活](docs/images/keep-alive-settings.png)

- 保活默认关闭，可为每个账号分别设置运行间隔、随机延迟和每日允许执行的时间窗口。
- “完成后关闭本次临时启动的浏览器”只关闭本次保活为离线目录启动的临时实例，不应关闭原本已经在线的浏览器。
- “立即运行一次”用于手动验证配置；定时任务会访问后台、检查重定向并同步可安全持久化的会话 Cookie，不会伪造业务操作。
- 若后续由 Agent 统一调度保活，建议保持内置保活关闭，避免两套调度同时操作同一个浏览器数据目录。

### 7. 归档、恢复与永久移除

![归档账号管理](docs/images/archive-management.png)

- 归档账号会从活动列表移入“已归档账号”，可以随时恢复，也可以永久移除账号记录。
- 账号归档不会删除浏览器数据。只有目录内没有活动账号、浏览器已关闭后，目录本身才允许归档。
- 永久移除账号和删除浏览器数据是两个独立动作。目录删除界面会明确区分“仅取消登记并保留本机文件”和“同时删除插件创建的本机目录”。
- 自定义目录和旧版迁移目录永远只能取消登记；物理删除只允许插件默认根目录下、所有权标记完全匹配的目录，并要求再次输入完整目录名称确认。

## 核心特点

### 平台账号管理

- 新增、编辑、归档、恢复和永久移除账号记录。
- 平台名称自由输入，可兼容电商、内容、广告、客服和企业系统。
- 内置常见平台建议，但不把平台限制在固定枚举中。
- 后台地址和登录地址由用户配置，至少填写一个。
- 活动账号由“平台名称 + 账号名称”唯一识别，创建、编辑和恢复时都会拒绝重复组合；归档账号允许保留历史重名记录。
- “Agent 操作说明”用于提供账号用途、业务范围和注意事项等上下文，不是权限控制规则。

### 浏览器数据目录管理

- 每个目录固定使用 Chromium 的 `Default` 用户，不再引入额外的浏览器用户/Profile 层级。
- 新建账号时可以：
  - 在全局默认根目录下自动创建独立数据目录；
  - 通过系统原生目录选择器指定绝对路径；
  - 复用插件中已有的浏览器数据目录。
- UI 展示完整目录地址，并提供复制和打开文件夹操作。
- 支持 Google Chrome 与 Microsoft Edge。
- 自定义新目录必须为空，避免覆盖已有浏览器资料。
- 已登记的目录不允许重复或互相嵌套，降低误用风险。
- 账号创建后不支持换绑或移动到其他目录，避免跨目录复制登录资料带来的损坏与串号风险。
- 目录可以重命名，重命名只改变 UI 显示名称，不改变磁盘地址。

### 浏览器数据目录生命周期

目录与账号分别归档：

1. 先归档目录中的所有活动账号；
2. 确认该目录对应的浏览器已经关闭；
3. 再归档目录；
4. 归档目录可以恢复，也可以进入删除流程。

UI 会分别显示活动账号引用数和归档账号引用数。删除归档目录时，所有仍引用它的归档账号记录会在同一次确认操作中永久移除，避免留下失效引用。

删除提供两种模式：

- **仅移除目录登记，保留本机文件**：适用于所有目录来源；
- **移除登记并删除本机浏览器数据**：只适用于插件在默认 `browserDataRoot/<directory-id>` 下创建的目录。

物理删除必须同时满足：目录已归档、浏览器离线、没有活动账号引用、路径严格位于默认根目录、目录不是符号链接或联接、所有权标记与目录记录完全匹配，并由用户输入完整目录名称确认。旧版 `profiles/` 目录和用户自定义目录永远只能取消登记，插件不会递归删除其本机文件。

### 共享与隔离可以按业务选择

**独立目录**适合：

- 同一平台的多个账号；
- 必须严格隔离 Cookie 和站点存储的账号；
- 风控敏感或权限边界不同的业务。

**共享目录**适合：

- 同一组织下彼此信任的多个不同平台；
- 希望共用一个浏览器进程，减少内存与进程数量；
- 需要在同一浏览器环境中保留关联站点状态。

共享目录意味着共享全部浏览器状态，不只是某一个平台的 Cookie。关闭这个目录对应的浏览器时，该目录下所有账号页面都会一起关闭。

## Cookie 持久化机制

Chromium 原本会把普通持久 Cookie 保存到浏览器数据目录，但部分登录状态使用“会话 Cookie”，默认可能随着浏览器会话结束而清除。

插件在托管浏览器在线时执行以下流程：

1. 通过本机 CDP 读取当前浏览器上下文中的 Cookie。
2. 只选取会话 Cookie，并跳过无法安全复制的不透明分区 Cookie。
3. 使用 `Storage.setCookies` 为可处理的会话 Cookie 设置本地到期时间。
4. 由 Chromium 自己把更新后的 Cookie 写回原浏览器数据目录。
5. 下次启动时继续使用同一个数据目录，由 Chromium 恢复 Cookie 和其他站点存储。

浏览器启动后的前 60 秒每 2 秒同步一次，之后每 15 秒同步一次；人工标记已登录、关闭浏览器和登录检测也会触发同步。

### 这项机制的边界

- 它只能改变本机 Cookie 的持久化属性和到期时间。
- 它不能延长服务端 token、session、refresh token 或设备授权的有效期。
- 它不能阻止平台主动注销、异地登录失效、密码变更失效或风控校验。
- 它不能绕过验证码、扫码、设备验证或多因素认证。
- 平台仍可根据服务端策略随时要求重新登录。
- Cookie 和浏览器数据目录属于敏感认证资料，应像密码一样保护，不应上传到代码仓库或共享网盘。

## 固定 CDP 端口与登录风控

开发期间对 Chrome 和 Edge 做了控制变量测试：

| 启动方式 | 实测结果 |
| --- | --- |
| 不启用远程调试 | 账号密码登录成功 |
| `--remote-debugging-port=0` | 登录验证持续失败 |
| 固定的非零远程调试端口 | 登录成功 |

在本次环境中，`port=0` 会使 Chromium 暴露 `AutomationControlled` 特征，而固定非零端口没有触发同样结果。因此插件采用：

```text
--remote-debugging-address=127.0.0.1
--remote-debugging-port=<运行时分配的固定非零端口>
--user-data-dir=<浏览器数据目录>
```

同时遵循以下限制：

- 调试服务只监听 `127.0.0.1`。
- 不添加 `--enable-automation`。
- 不使用 `--remote-debugging-port=0`。
- 不向 UI 或 Agent 工具返回调试端口。
- 端口只保存在本地运行时登记文件中。

这是针对当前 Chrome、Edge 与目标平台的实测结论，不代表所有平台风控都采用相同判断。启用 CDP 仍可能被某些站点识别。

固定端口启动时 Chromium 不会提供可依赖的 `DevToolsActivePort` 文件，因此插件维护独立的 `browser-runtime.json`，记录“数据目录 -> PID、端口、实例 ID”的对应关系。DSH 重启后会验证 PID 和 CDP 健康状态，只恢复仍然有效的记录，并清理陈旧记录。

## 登录状态检测

每个账号都可以随时执行“检测登录状态”。检测流程严格限制为：

1. 如果浏览器尚未运行，直接以后台地址启动浏览器并复用该标签检测，不创建 `about:blank` 占位页；
2. 如果浏览器已经运行，创建一个临时检测标签，避免改动现有页面；
3. 等待页面跳转稳定；
4. 根据最终 URL、后台域名和登录地址判断是否发生登录重定向；
5. 同步 Cookie；
6. 在线浏览器只关闭本次创建的临时标签；检测前未运行的浏览器则根据调用场景在检测后关闭整个临时实例。

登录检测不会读取页面正文、生成 DOM 快照、点击控件、输入账号密码或处理验证码。

检测结果包括：

- `valid`：受保护后台地址成功打开，未落到登录地址；
- `invalid`：最终地址是配置的登录地址或明显的登录路径；
- `unknown`：通用 URL 规则无法证明是否已登录；
- `error`：浏览器启动、页面加载或 CDP 通信失败；
- `unchecked`：尚未检测。

对于登录页和后台页使用完全相同 URL、单页应用内部切换状态或不发生 URL 跳转的平台，检测可能返回 `unknown`。

账号行只保留一个“检测登录状态”入口。检测完成后显示结果弹窗：`valid` 自动标记有效，`invalid` 自动标记失效，只有 `unknown` 或 `error` 才显示“人工标记为已登录”。人工确认会清除旧的自动失败展示，并记录来源和时间；它只表示用户完成了人工核验，不代表插件从平台服务端取得了有效性证明。

## 定时会话保活

内置定时保活默认关闭。

账号可以独立设置：

- 是否启用；
- 运行间隔，范围 `1` 到 `720` 小时；
- 随机延迟，范围 `0` 到 `240` 分钟；
- 允许运行的每日时间窗口；
- 本次任务临时启动浏览器后是否自动关闭；
- 立即运行一次。

调度器每分钟检查到期任务。共享同一个浏览器数据目录的到期账号会被分为一组，在同一个浏览器进程中依次检测，减少重复启动成本。

每次运行会访问账号配置的后台地址、观察登录重定向并同步 Cookie。失败任务使用指数退避，最大放大到正常间隔的 8 倍。

定时访问可以让平台有机会刷新 Cookie 或服务端会话，但是否刷新、刷新多久完全取决于平台。插件不会伪造业务操作，也不保证会话一定被延长。

当前版本只在账号管理器内部串行化同一目录的启动、检测、Cookie 同步和关闭操作，没有实现跨插件的“前台任务租约”。如果另一个插件正在操作同一浏览器，内置保活仍可能打开或关闭临时标签页而影响任务。计划由 Agent 定时任务负责保活时，建议保持内置保活关闭，让 Agent 在没有业务任务时调用 `platform_account_check_login`；不要同时启用两套调度。

## Agent 工具

插件只向 Agent 注册四个会话管理工具：

| 工具 | 作用 |
| --- | --- |
| `platform_account_list` | 按平台名称和账号名称列出账号、登录检测、保活和浏览器状态 |
| `platform_account_open` | 在托管浏览器中打开配置的后台或登录地址 |
| `platform_account_check_login` | 访问配置的后台地址并根据重定向检测登录状态 |
| `platform_browser_close` | 同步 Cookie 后关闭整个浏览器数据目录对应的浏览器 |

`platform_browser_close` 会经过 DSH 工具批准流程，因为共享目录下可能有多个账号受到影响。

工具输出不包含：

- 浏览器数据目录路径；
- CDP 端口和 WebSocket 地址；
- Cookie 值；
- 密码或验证码。
- 平台登录用户名、手机号或邮箱，以及后台地址和登录地址。

Agent 先使用 `platformName + name` 识别目标账号，再把返回的 `id` 传给其他工具。目录名称、目录 ID 和目录地址都不参与 Agent 的账号识别。

## 明确不做什么

这个插件不提供通用页面自动化，因此没有以下能力：

- 页面 DOM 快照；
- 文本抓取和元素引用；
- 任意 URL 导航；
- 点击、输入、按键；
- iframe 或弹窗控制；
- 验证码识别；
- 绕过平台风控。

需要操作页面的插件应作为独立插件开发，通过内部会话服务连接已打开的受信任浏览器，而不是把页面操作重新塞回账号管理器。

## 内部会话服务

插件在 Cordis 上提供 `ctx.platformSessions`，供本机受信任插件使用：

```ts
interface PlatformSessionService {
  list(): Promise<PlatformAccount[]>
  open(accountId: string): Promise<PlatformStatus>
  close(accountId: string): Promise<void>
  checkLogin(accountId: string): Promise<LoginCheckResult>
  connection(accountId: string): Promise<TrustedBrowserConnection>
}
```

`connection()` 返回环回地址上的内部 CDP endpoint。它不会通过本地 HTTP API 或 Agent 工具公开。未来的浏览器操作插件应注入 `platformSessions` 服务，并继续自行定义操作范围、批准规则和审计策略。

## 架构

```mermaid
flowchart LR
  UI[平台管理 UI] --> API[Loopback HTTP API]
  AGENT[DSH Agent] --> TOOLS[4 个会话管理工具]
  AUTOMATION[受信任浏览器插件] --> SERVICE[platformSessions 服务]

  API --> REPO[AccountRepository]
  API --> BROWSER[BrowserManager]
  TOOLS --> REPO
  TOOLS --> BROWSER
  SERVICE --> REPO
  SERVICE --> BROWSER
  TIMER[KeepAliveScheduler] --> REPO
  TIMER --> BROWSER

  REPO --> META[accounts.json]
  BROWSER --> RUNTIME[browser-runtime.json]
  BROWSER --> CHROMIUM[Chrome / Edge]
  CHROMIUM --> PROFILE[浏览器数据目录]
```

### 模块职责

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 插件配置、依赖注入和生命周期装配 |
| `src/shared.ts` | 账号、目录、状态和保活共享类型 |
| `src/store.ts` | v3 数据模型、迁移、目录生命周期、安全删除、校验和原子写入 |
| `src/browser.ts` | 浏览器启动、运行时登记、Cookie 同步和登录检测 |
| `src/maintenance.ts` | 定时保活、共享目录分组和失败退避 |
| `src/api.ts` | 仅限本机 UI 的 HTTP API 与目录选择器 |
| `src/tools.ts` | Agent 可见的最小工具集 |
| `src/service.ts` | 供受信任插件使用的内部会话服务 |
| `src/client/` | DSH 设置页中的“平台管理”界面 |

本项目遵循 DSH 的 Cordis 插件模型：通过 `inject` 声明依赖，通过 `ctx.effect()`、`ctx.interval()` 和 Service 生命周期注册可撤销资源。参考 [DeepSeek Harness 插件开发文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) 与 [DSH 架构说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)。

## 数据模型与本地文件

默认数据目录：

```text
%DSH_HOME%/store-account-manager/
```

未设置 `DSH_HOME` 时，通常为：

```text
~/.dsh/store-account-manager/
```

目录内容：

```text
store-account-manager/
├── accounts.json                # v3 元数据，不保存密码和 Cookie 值
├── accounts.v1.backup.json      # 首次从 v1 迁移时创建
├── accounts.v2.backup.json      # 首次从 v2 迁移时创建，内容与原文件完全一致
├── browser-runtime.json         # 当前浏览器 PID 与环回 CDP 端口
├── profiles/                    # v1 账号原有目录，迁移后仍原地使用
└── browser-data/                # 默认新建目录根路径
    └── <directory-id>/
        ├── .dsh-browser-data.json
        └── Default/             # Chromium 自己维护的数据
```

> 兼容性说明：磁盘目录继续使用 `store-account-manager` 这个 v0.3.0 早期名称。公开包名和插件 ID 的调整不会移动浏览器数据，请不要手动重命名该目录。

账号元数据与浏览器状态分离：

- 一个 `PlatformAccount` 必须指向一个 `BrowserDataDirectory`；
- 多个账号可以指向同一个目录；
- 目录记录包含浏览器类型、绝对路径和 `plugin-created`、`custom` 或 `legacy` 来源；
- Cookie 不会复制到 `accounts.json`；
- 所有 JSON 更新使用临时文件加原子重命名写入。

## 安全与隐私边界

- HTTP API 只接受环回连接。
- 带 `Origin` 的请求只接受 `localhost`、`127.0.0.1` 或 `::1`。
- API 响应禁用缓存，并设置 `X-Content-Type-Options: nosniff`。
- 浏览器路径只返回给本机设置 UI，不进入 Agent 工具结果。
- CDP 只绑定环回地址，端口不会向 Agent 暴露。
- 插件不收集、不提交、不上传任何账号或浏览器数据。
- 插件不会读取或保存账号密码。
- 账号记录删除与目录删除分离，目录物理删除需要多重所有权校验和显式确认。

环回 CDP 仍然是一项高权限本机能力。同一操作系统用户下的恶意进程可能尝试探测本机端口，因此应确保电脑账户、插件来源和本地进程可信。

## 安装

### 环境要求

- Node.js `>= 22.19`
- pnpm
- DSH Web Profile
- Google Chrome 或 Microsoft Edge

### 本地开发安装

```powershell
git clone https://github.com/sycamorestr/dsh-platform-account-manager-plugin.git
cd dsh-platform-account-manager-plugin
pnpm install
pnpm build
dsh plugin --profile web add link:$PWD
dsh web --no-open
```

然后打开：

```text
http://127.0.0.1:3080/
```

进入 DSH 设置，选择“平台管理”。

链接安装后，源码更新需要重新执行 `pnpm build` 并重启 DSH。DSH Profile 通过 bundle 的 `cordis.patch.yml` 挂载插件；官方说明见 [Profiles 与 bundles](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#profiles-and-bundles)。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | `~/.dsh/store-account-manager` | 元数据、运行时登记和 v1 旧目录根路径 |
| `browserDataRoot` | `<dataDir>/browser-data` | 自动创建浏览器数据目录的默认根路径 |
| `cookieRetentionDays` | `365` | 会话 Cookie 转为持久 Cookie 时使用的本地期限，范围 1-3650 天 |
| `chromePath` | 自动检测 | Chrome 可执行文件绝对路径 |
| `edgePath` | 自动检测 | Edge 可执行文件绝对路径 |

可以在 Web Profile 的 `cordis.patch.yml` 中覆盖完整配置：

```yaml
- id: platform-account-manager
  config:
    dataDir: 'D:\DSH\platform-manager'
    browserDataRoot: 'E:\BrowserData'
    cookieRetentionDays: 365
    chromePath: 'C:\Program Files\Google\Chrome\Application\chrome.exe'
    edgePath: 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
```

DSH 的配置 patch 会整体替换目标行的 `config`，修改时应保留需要的全部字段。

## 数据迁移

### v1 到 v3

如果检测到 `accounts.json` 的版本是 `1`：

1. 原文件原样备份为 `accounts.v1.backup.json`；
2. 每个旧账号创建一个同 ID 的浏览器数据目录记录；
3. 目录地址继续指向原来的 `profiles/<account-id>`；
4. 不移动、复制、扫描或导出原有 Cookie；
5. 将旧目录标记为 `legacy`，不授予插件物理删除权限；
6. 原子写入 v3 `accounts.json`。

迁移不会把旧浏览器资料搬到新的 `browser-data/`。旧登录状态能否继续使用，仍由原目录内容和平台服务端有效期决定。

### v2 到 v3

首次由 `0.2.x` 升级到 `0.3.0` 时：

1. 原文件逐字节备份为 `accounts.v2.backup.json`；
2. `profiles/<account-id>` 推断为 `legacy`；
3. 精确位于 `browserDataRoot/<directory-id>` 的目录推断为 `plugin-created`；
4. 其余地址推断为 `custom`；
5. 已有自动检测结论标记为 `automatic`，没有自动有效结论的 `ready` 状态标记为 `manual`；
6. 只更新元数据，不移动、复制、扫描或导出任何浏览器目录与 Cookie。

## 常用操作

### 新建独立账号

1. 打开“平台管理”。
2. 选择“新增账号”。
3. 填写平台名称、账号名称和后台/登录地址。
4. 选择“新建数据目录”。
5. 选择 Chrome 或 Edge，可选自定义空目录。
6. 创建后点击“打开平台”，在浏览器中手动登录。
7. 回到 DSH 点击“检测登录状态”；通用规则无法判断时，可在结果弹窗中人工标记。

### 让多个平台共享一个目录

1. 新增第二个账号。
2. 选择“复用已有目录”。
3. 选择目标目录并创建。

共享后，这些账号使用同一个浏览器进程和全部站点数据。不要用它承载需要互相隔离的同平台账号。

### 把数据放到非系统盘

有两种方式：

- 修改全局 `browserDataRoot`，让后续自动创建目录都进入指定磁盘；
- 新增账号时选择一个自定义空目录，只覆盖当前新目录。

## 故障排查

### 浏览器打开后仍是登录页

- 点击“检测登录状态”查看最终判断。
- 确认打开的是同一个浏览器数据目录。
- 确认没有手动用普通 Chrome/Edge 同时占用该目录。
- 平台服务端 token 可能已经失效，需要重新登录。
- 登录流程可能要求扫码、验证码或设备验证，插件不会代为处理。

### 账号密码登录时验证码始终失败

- 确认浏览器启动参数不是 `--remote-debugging-port=0`。
- 当前插件只使用固定非零端口，不添加 `--enable-automation`。
- 即使如此，平台仍可能根据设备、网络、行为或 CDP 特征触发风控。
- 可在平台允许的情况下使用扫码等官方登录方式。

### 提示数据目录已被占用

Chromium 不允许多个浏览器进程同时安全写入同一个用户数据目录。关闭手动打开的同目录浏览器，再由插件重新打开。

### 自定义目录无法创建

- 必须是绝对路径；
- 不能是磁盘根目录或系统程序目录；
- 不能是网络 UNC 路径；
- 新目录必须为空；
- 不能与已登记目录相同、互为父目录或子目录。

### 登录检测返回 `unknown`

检查后台地址与登录地址是否准确。部分单页应用不通过 URL 表达登录状态，通用检测无法可靠判断；这类平台可在结果弹窗中人工确认，并把更精确的适配规则放在未来的平台专用插件中。

### DSH 重启后显示浏览器离线

`browser-runtime.json` 只恢复 PID 和 CDP 端点都仍健康的浏览器。如果浏览器已经退出、PID 变化或端口不可访问，旧记录会被清除；再次点击“打开平台”即可重新建立运行时。

## 开发与验证

```powershell
pnpm typecheck
pnpm test
pnpm build
```

当前测试覆盖：

- v1 到 v3 与 v2 到 v3 原地迁移、完整备份、来源推断和旧目录保留；
- 自由平台名称和 HTTP(S) URL 校验；
- 自定义绝对路径、空目录、重复/嵌套目录拒绝；
- 新目录创建与已有目录复用；
- 账号更新、归档、恢复和移除；
- 活动账号“平台名称 + 账号名称”唯一性；
- 目录重命名、归档、恢复、归档账号级联与受保护物理删除；
- 自动检测与人工确认来源切换；
- 归档目录和归档账号的 API 装饰；
- 保活时间窗口与确定性调度；
- 固定非零 CDP 端口和启动参数；
- 会话 Cookie 持久化参数转换；
- 陈旧运行时登记清理；
- Agent 工具面收敛；
- 登录检测不进行 DOM 或正文提取。

构建输出：

- `lib/index.js`：Node 端插件；
- `lib/index.js.map`：服务端 source map；
- `lib/client.js`：DSH Web 客户端模块。

## 设计原则

1. **本地优先**：账号元数据和浏览器资料都留在用户指定的本机目录。
2. **目录是真正的身份边界**：是否共享 Cookie 由浏览器数据目录决定，不制造额外的“浏览器空间”概念。
3. **最小 Agent 能力**：账号管理器只暴露会话管理工具，不暴露通用网页控制。
4. **可恢复运行时**：固定端口通过独立登记文件恢复，不依赖 `DevToolsActivePort`。
5. **迁移不搬数据**：旧浏览器目录原地沿用，降低登录态和大体积文件迁移风险。
6. **失败显式可见**：登录检测、Cookie 同步和保活结果都进入 UI 状态。
7. **不夸大持久化能力**：本地 Cookie 期限与平台服务端有效期是两件事。
8. **危险删除必须证明所有权**：自定义和旧版目录默认不受插件物理删除能力控制。

## License

MIT

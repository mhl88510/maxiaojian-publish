# maxiaojian-publish

**为多账号内容工作流准备的本地发布器：发布视频和图文，同时核对账号、素材与提交结果。**

它把上传、编辑准备、草稿、最终提交和回读连接成可追踪的流程。维护者持续使用的原发布器是本项目基线；独立版本保留真实发布能力，也保留身份不符即停止、一次提交和未知结果先对账等保护。

[开始安装](#开始安装) · [配置自己的账号](docs/CONFIGURATION.md) · [逐平台能力与限制](docs/SUPPORT.md)

## 适合谁

- 已使用 Ego Lite，希望把多平台、多账号发布整理成 CLI 工作流的个人创作者或内容团队。
- 需要确认“发给了哪个账号、使用了哪份素材、结果是否已核实”的开发者。
- 想在自己的环境中接入、修改或扩展原生平台适配器的维护者。

这是需要配置的本地工具。安装者需要自己的账号、素材和已授权浏览器会话；仓库不提供登录态，也不会替你决定发布内容或版权归属。

## 能做什么

- **视频与图文发布**：通过原生平台工作台准备内容；在支持的路径上创建草稿、提交发表并回读结果。
- **明确绑定目标**：核对平台账号及 Ego 工作空间、页面和身份，避免凭页面位置猜账号。
- **绑定真实素材**：使用媒体指纹、封面与准备凭据检查同一任务的内容。
- **一次提交**：写入预约与最终点击门禁限制重复提交；结果不明时保留记录，先对账再决定下一步。
- **离线开发**：用虚构内容、模拟适配器及合同测试检查改动，不必连接真实账号。

真实写操作需要显式 `--execute`。它表示此次调用允许上传、编辑、保存草稿或发表，具体影响取决于所选平台和动作。

## 平台范围

| 平台 | 当前代码提供的路径 | 需要注意 |
| --- | --- | --- |
| 抖音、小红书、视频号、Bilibili | 视频准备、指定 PREPARED 状态最终提交、回读 | 需要各平台要求的账号、媒体与封面凭据；回读完成程度不能一概等同公开页确认 |
| 知乎、搜狐、头条 | 图文原生准备、提交与回读 | 受当前编辑器和控件合同约束；任意已保存草稿不保证可续发 |
| 微博 | 原生文本提交、回读 | 原版实现保留；没有为本发行版补称真实发表实测 |
| 微信公众号 | API 草稿、发布与状态读取 | 还需外部 Baoyu/AWS 微信工具链及自己的 API 配置 |
| YouTube | 原版视频上传／编辑准备 | 统一最终发布后端尚未覆盖 |
| 百家号、网易号 | 原版管理与回读能力；百家号有特定试验写入路径 | 通用文章写入仍受原版未验证阻断限制 |

完整边界以 [SUPPORT](docs/SUPPORT.md) 为准。原版实测、独立包离线测试和当前账号的实时兼容性是不同证据，不应混写。

## 开始安装

运行要求：

- Node.js 22+、npm。
- 已安装并连接的 Ego Lite／`ego-browser` CLI，具备原版使用的 TaskSpace/Page API。
- 视频处理所需的 ffmpeg、ffprobe。
- 自己的账号绑定、内容文件与授权会话。

原版运行环境和本次安装验证均为 macOS；Linux、Windows 尚未实机验收。普通 Chrome 或 Playwright 不能直接替代 Ego API。

```sh
git clone https://github.com/mhl88510/maxiaojian-publish.git
cd maxiaojian-publish
npm ci --ignore-scripts --no-audit --no-fund
npm link --ignore-scripts
maxiaojian-publish --help
maxiaojian-publish --list
```

已有所需运行时的用户也可用 `npm install -g github:mhl88510/maxiaojian-publish`。本项目尚未发布 npm registry 包，不要把 registry 中的同名包当成这里的安装入口。

## 第一次使用

### 1. 配置自己的目标

将 `examples/accounts.json` 复制到自己的私有目录，替换虚构账号和 Ego 绑定。示例不能直接发布。

```sh
export SCHOOL_PUBLISHER_ACCOUNT_MATRIX="$(pwd)/my-private/accounts.json"
export VIDEO_PUBLISHER_CONFIG="$(pwd)/my-private/video-config.json"
node core/config.mjs onboard --source-dir /path/to/your/media --available-platform douyin
maxiaojian-publish --account-status douyin demo_owner
```

这里的 `demo_owner` 应与自己配置中的账号 key 对应。账号不符、登录失效或工作空间未交由 Agent 控制时，应先处理阻塞，不要换账号绕过。

### 2. 准备并检查内容

视频格式参考 `examples/native-video.json`，图文参考 `examples/native-article.json`。替换为自己的文件、内容和目标后检查：

```sh
maxiaojian-publish /path/to/package.json --action check
```

### 3. 执行获授权的动作并回读

视频先准备，再使用返回的 `preparedStatePath` 最终提交：

```sh
maxiaojian-publish /path/to/package.json --action draft --execute --confirm-original-rights
maxiaojian-publish /path/to/package.json --action publish --prepared-state /path/to/state.json --execute
maxiaojian-publish /path/to/package.json --action status
```

`draft` 可能上传素材、填写编辑器或保存草稿；`publish` 可能公开发表。已打通的图文路径可使用 `--action publish --execute`，但文章续传仍须满足原后端的具体凭据和编辑器条件。公众号按草稿 `mediaId` 提交，再按 `publishId` 回读。

重复或未知结果先对账。不要删除锁／回执、改标题或换后端来补发。

具体文章 selectors、公众号外部工具、视频回读路由与配置项见 [配置说明](docs/CONFIGURATION.md)。默认运行记录使用独立的 `~/.maxiaojian-publish`，不会复用原生产账本。

## 不连接账号也能体验流程

```sh
maxiaojian-publish init-demo ./demo
maxiaojian-publish simulate ./demo/package.json --state-root ./demo --execute
```

这会创建虚构包并操作本地模拟账本。示例媒体是占位字节，不能当真实素材上传；模拟成功不代表平台已发表。

## 开发与验证

核心使用 Node.js / ES modules，平台适配与账号约束位于 `core/`，编包和模拟辅助位于 `lib/`，虚构配置位于 `examples/`。

```sh
npm run check
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

0.1.0 在本机通过 188 项 Node 测试、11 项 Python 测试及干净安装检查。公开仓库目前只配置手动触发的工作流，本次 push 没有 CI 运行记录，因此不展示 CI 通过徽章。维护者确认原版已测试并持续使用；本次整理没有向业务账号执行真实发帖。

修改适配器时，请同时检查账号身份、媒体绑定、一次提交与结果不明后的处理路径，不要只让模拟成功分支通过。

---

MIT · 维护者 [mhl88510](https://github.com/mhl88510) · [原创许可](LICENSE) · [上游 MIT 声明](LICENSE.upstream-MIT)

基于 [oil-oil/video-publisher-skill](https://github.com/oil-oil/video-publisher-skill) 持续定制，保留适用版权说明。账号映射、登录态、业务素材、旧回执与原业务仓库历史不随包分发。分享运行输出前请检查账号、作品 ID 和本机路径，详见 [隐私说明](docs/PRIVACY.md)。

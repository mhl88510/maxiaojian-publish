# maxiaojian-publish

保留真实发布能力的多账号发布器，MIT，维护者 [mhl88510](https://github.com/mhl88510)。从持续实际使用的发布器独立整理，支持明确执行、账号核验、素材绑定、一次提交与结果回读。原版已由维护者测试并使用；本发行版的提取、配置和打包做离线回归，没有代替维护者向真实账号发帖。

## 安装

需要 Node.js 22+、npm、ffmpeg/ffprobe，以及已安装、连接并授权的 **Ego Lite / ego-browser CLI**。原生平台流程使用 `ego-browser nodejs` 的 TaskSpace/Page API；普通 Chrome/Playwright 不是可直接替换的运行时。此仓库不附浏览器、登录态或账号配置。原版运行环境为 macOS；Windows/Linux 未实机验收。

```sh
git clone https://github.com/mhl88510/maxiaojian-publish.git
cd maxiaojian-publish
npm ci --ignore-scripts --no-audit --no-fund
npm link --ignore-scripts
maxiaojian-publish --help
maxiaojian-publish --list
```

也可以在已有运行时上 `npm install -g github:mhl88510/maxiaojian-publish`。尚未发布 npm registry 包，不要用同名 registry 包代替本仓库。package 的 private 标记只防止误发 npm，不禁止安装或发布内容。

## 配置账号与素材

复制 `examples/accounts.json` 到自己私有配置目录，填写自己的账号名、平台 ID、Ego profile、TaskSpace 的 ID/名称、Page label 和 targetId。示例全部虚构，**不能直接执行**。只使用自己明确交由 Agent 控制的工作空间；遇到用户控制、未登录或账号身份不符会停止。不要把登录态或凭据写入本仓库。

```sh
export SCHOOL_PUBLISHER_ACCOUNT_MATRIX="$(pwd)/my-private/accounts.json"
export VIDEO_PUBLISHER_CONFIG="$(pwd)/my-private/video-config.json"
# 仅在自己已经准备好的媒体目录上完成本机配置：
node core/config.mjs onboard --source-dir /path/to/your/media --available-platform douyin
maxiaojian-publish --account-status douyin demo_owner
```

原生视频包格式见 `examples/native-video.json`，文章见 `examples/native-article.json`；将示例路径改为真实媒体/文章文件，填写账号绑定。高级字段、文章 selector 合同、公众号外部依赖见 [配置说明](docs/CONFIGURATION.md)。默认运行账本在独立的 `~/.maxiaojian-publish`，视频配置在 XDG config 下的 `maxiaojian-publish/config.json`；不复用旧生产账本。

## 实际使用

以下命令由安装者在自己的账号和素材上执行。`draft` 可能上传素材、填写编辑器或保存草稿；`publish` 可能公开发表，必须明确传入 `--execute`。先检查目标和内容。

```sh
maxiaojian-publish /path/to/package.json --action check
maxiaojian-publish /path/to/package.json --action draft --execute --confirm-original-rights
# 视频最终发表使用上一步输出的 preparedStatePath：
maxiaojian-publish /path/to/package.json --action publish --prepared-state /path/to/state.json --execute
maxiaojian-publish /path/to/package.json --action status
```

已打通的知乎、搜狐、头条和微博原生路径可直接 `--action publish --execute`，仍会先身份/编辑器/内容检查。文章 --prepared-state 只用于原后端认可的特定未提交失败合同，不是任意草稿续发。公众号先生成草稿，再用返回的 mediaId 发起发布，随后用 publishId 回读。完整范围见 [平台支持](docs/SUPPORT.md)。功能受各平台当前页面、账号资质和原有安全合同约束，不保证每个账号、每种内容均可发表。

重复或未知结果必须先对账；不要删除锁/回执、换后端或改标题绕过去重。视频最终按钮默认被拦截，仅当全部门禁和指定 PREPARED 状态验证通过时放行一次。失败不是再次提交的许可。

## 离线验证

```sh
npm run check
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
maxiaojian-publish init-demo ./demo
maxiaojian-publish simulate ./demo/package.json --state-root ./demo --execute
```

模拟媒体是占位字节，不能当真实素材上传。模拟适配器、合成 DOM 和依赖注入测试不连接账号。`read-only` 子命令是额外的当前页面探针，不替代真实发布入口。跨系统 workflow 定义只是待执行配置，不能视为 CI 已通过。

## 许可和隐私

MIT，保留上游 oil-oil 的 MIT 版权声明。分发不含账号映射、业务素材、登录态、原始回执或旧仓库历史。请将个人配置、素材、运行记录放在仓库外；示例中的 `my-private/` 已忽略。见 [隐私与安全](docs/PRIVACY.md)。

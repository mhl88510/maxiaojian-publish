# 升级、卸载与反馈 / Upgrade, uninstall, and report bugs

[中文首页](../README.md) · [English README](../README.en.md)

## 固定发行版 / Fixed releases

从 [GitHub Releases](https://github.com/mhl88510/maxiaojian-publish/releases)取得对应版本的 tgz 和 SHA256SUMS.txt，并核对发布说明中的来源提交与校验值。先核验再安装；包名相同不代表文件内容相同。不要把早期私有交付的 0.1.0 包与正式 Release 资产混为一份。

Download a version's tgz and SHA256SUMS.txt from [GitHub Releases](https://github.com/mhl88510/maxiaojian-publish/releases). Check the source commit and checksum in the release notes before installing. Identical package names do not imply identical bytes. Do not confuse an earlier privately delivered 0.1.0 package with the formal Release asset.

macOS / Linux（在下载文件所在目录） / macOS / Linux, in the download directory:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

PowerShell（与 SHA256SUMS.txt 中的值人工比较） / PowerShell, compare manually with SHA256SUMS.txt:

```powershell
Get-FileHash .\maxiaojian-publish-0.1.0.tgz -Algorithm SHA256
```

这些校验命令不表示 Windows/Linux 的真实平台发布工作流已经验收。详见 [SUPPORT](SUPPORT.md)。

These checksum commands do not establish that live publishing workflows have been verified on Windows/Linux. See [SUPPORT](SUPPORT.md).

## 升级前 / Before upgrading

### 任务完成触发的 PR 与本地采用 / Task-triggered PR and local adoption

维护顺序是：发现问题 → 本地修复和离线验证 → 按同一主题集中创建或更新一个 PR → 对当前提交完成审查、修复复测 → 合并 → 在明确获准更新本地时备份并采用。映射只记录源码、公开仓库与运行文件的对应关系，不是定时同步或文件监听器。不要将私有业务源码、配置或原历史整库推到公开仓库。

The sequence is local fix and affected offline tests, one consolidated same-topic PR, exact-head review/fix/retest, merge, and then separately authorized backed-up local adoption. File mappings are routing metadata, not timers or watchers. Never mirror private business source, configuration or original history into this public repository.

`scripts/task_pr.py` 可接收仓库外的完成清单（`schema=completed-public-topic/v1`、稳定 `topic`、`files=[{path,sha256}]`），只在独立检出中暂存指定字节，运行离线检查和完整公开历史敏感扫描，再用 `--pr` 创建或更新同主题 PR。已有 PR 时清单还须绑定最新 `expected_pr_head`；先合并审查修复，不能用旧源码覆盖。未提供 `--pr` 不推送。此工具不会合并、部署或定时运行；合并仍须由执行者核当前 head 的完整审查。

The optional task PR helper requires an external completed-file manifest, an isolated work directory and an explicit `--pr` to push. It never stages an entire shared checkout or imports original private history, and rejects private configuration, source drift and unexpected existing PR heads. The executor still verifies the exact-head review before merging and separately verifies local adoption.

`scripts/reviewed_core_update.py`（Python 3.9+、Git、已认证的 GitHub CLI）提供显式两阶段采用。私有 binding 文件保存在仓库外：`schema=publisher-local-core-bindings/v1`、`repo`、`runtime_root`、`files=[{source,target,expected_sha256}]`，可选 `protected=[{path,sha256}]`。只登记已核可共用的 `core/*.mjs` 文件；源码与运行相对路径必须对应。账号配置、个案恢复或已定制文件不能为了对齐而覆盖。无对应通用文件时先做局部适配和验证。

The explicit two-phase helper requires Python 3.9+, Git and an authenticated GitHub CLI. Keep the private binding file outside the repository. Only register verified shared core modules; preserve private configuration and case-specific/customized adapters. Customized modules require an explicit scoped reconciliation, not bulk replacement. Both phases check the merged PR, exact completed clean Codex review, unresolved discussions and configured checks. Empty check lists do not imply CI ran.

```sh
python3 scripts/reviewed_core_update.py plan --checkout /path/to/clean-checkout --bindings /path/to/private-bindings.json --backup-root /path/to/private-backups --pr 123 --plan /path/to/new-plan.json
python3 scripts/reviewed_core_update.py apply --plan /path/to/new-plan.json --expected-plan-sha256 <printed-plan-sha256>
```

该工具只读取 Git/GitHub 元数据并备份、核对和替换明确登记的本地源码；不调用发布器、浏览器或真实平台。原文件漂移、符号链接、审查未通过或计划指纹不符均停止。完成后仍要运行受影响离线检查；不得借升级重放未知结果、清锁或修改回执。 / The helper never invokes publishing or a browser. It rejects drift, symlinks and unreviewed changes, preserves preimages, and rolls back its own writes on failure without overwriting concurrent edits. Run affected offline checks afterward; never replay business operations or clear locks/receipts as part of an upgrade.

先保留自己的配置与运行记录，并确认没有运行中的任务。默认目录为 `~/.maxiaojian-publish` 和 XDG config 下的 `maxiaojian-publish/config.json`；环境变量 `VIDEO_PUBLISHER_CONFIG`、`SCHOOL_PUBLISHER_ACCOUNT_MATRIX` 可指向其他私有位置。备份仅留本机，不提交仓库。

Keep your configuration and runtime records, and ensure no job is running. Defaults are `~/.maxiaojian-publish` and `maxiaojian-publish/config.json` under the XDG config directory. `VIDEO_PUBLISHER_CONFIG` and `SCHOOL_PUBLISHER_ACCOUNT_MATRIX` may point elsewhere. Keep backups local; do not commit them.

结果不明的旧提交先按原回执对账。不要删除锁、预约或回执来恢复；升级也不会自动证明旧任务可以重发。不同版本的恢复合同可能不同，不要复制或改写旧回执来绕过校验。

Reconcile uncertain submissions using the original receipts first. Never recover by deleting locks, reservations, or receipts; an upgrade does not authorize resubmission. Recovery contracts may differ between versions. Do not copy or alter old receipts to bypass checks.

## 按安装方式升级 / Upgrade by installation method

### Release tgz 或全局 npm / Release tgz or global npm

下载并校验目标版本后安装。下面是 v0.1.0；以后升级时替换成所选发行版文件，保留旧版本及其校验值以便追溯。

Download and verify the target version, then install it. The example is v0.1.0; for later upgrades, use that release's file and retain the previous version and checksum for traceability.

```sh
npm install -g ./maxiaojian-publish-0.1.0.tgz --ignore-scripts
maxiaojian-publish --help
maxiaojian-publish --list
```

从 GitHub 安装时可固定 tag，避免默认分支文档或代码变化：

For a GitHub install, pin a tag rather than following changes on the default branch:

```sh
npm install -g 'github:mhl88510/maxiaojian-publish#v0.1.0' --ignore-scripts
```

尚未发布 npm registry 包；不要将 `npm install -g maxiaojian-publish` 当成本仓库的安装入口。

There is no npm-registry release. Do not use `npm install -g maxiaojian-publish` as this project's installation entry.

### Git 检出 + npm link / Git checkout + npm link

在自己的仓库目录执行。先检查并保留本地改动，不使用强制覆盖或 reset。示例固定到 v0.1.0；为其他版本替换 tag。若 Git 因本地改动拒绝切换，先人工处理该冲突。

Run in your own checkout. Inspect and preserve local changes; do not force a checkout or reset. This example pins v0.1.0; replace the tag for another version. If local changes prevent switching, resolve that conflict first.

```sh
git status --short
git fetch origin --tags
git switch --detach v0.1.0
npm ci --ignore-scripts --no-audit --no-fund
npm link --ignore-scripts
```

### 本地 npm prefix / Local npm prefix

仅当你原来使用 `npm install --prefix ...` 安装时，使用同一个安装根目录。将占位路径换为自己的目录；不要误指向运行账本或私有配置目录。

Only use this if you originally installed with `npm install --prefix ...`. Use that same installation root, replacing the placeholder path; do not point it at runtime records or private configuration.

```sh
npm install --prefix /path/to/install-root ./maxiaojian-publish-0.1.0.tgz --ignore-scripts
```

帮助与列表成功只说明安装可运行，不代表账号已就绪。实际写入前仍需自己的绑定、身份预检、媒体凭据与明确授权。

Successful help/list output only establishes a runnable installation, not account readiness. Real writes still require your bindings, identity preflight, media evidence, and explicit authorization.

## 卸载 / Uninstall

全局安装或 `npm link`： / Global installation or `npm link`:

```sh
npm uninstall -g maxiaojian-publish
```

本地 prefix 安装： / Local-prefix installation:

```sh
npm uninstall --prefix /path/to/install-root maxiaojian-publish
```

这会移除该安装位置中的 npm 包或全局链接及其 CLI 入口（含 `school-publisher` 别名），不删除源码检出、`my-private/`、外部账号矩阵、默认配置或 `~/.maxiaojian-publish` 账本。本指南没有清除这些私有数据的命令。若单独给 Agent 注册过 Skill，请按客户端规则移除自己添加的入口；npm 卸载不会自动清理所有客户端的技能目录。正在处理未知结果的任务应先保留记录并对账。

This removes the npm package/global link and CLI entries, including the `school-publisher` alias, from that installation. It does not delete your source checkout, `my-private/`, external account matrix, default configuration, or `~/.maxiaojian-publish` ledger. This guide gives no command to erase those private records. If you separately registered an Agent Skill, remove only the entry you added using your client's rules; npm uninstall does not clean every client's skill directory. Retain records and reconcile any uncertain job first.

## 报错与贡献 / Bugs and contributions

使用 [Bug 模板](https://github.com/mhl88510/maxiaojian-publish/issues/new?template=bug_report.yml)，提供版本/公开提交、安装方式、OS/Node/npm/Ego 版本，以及虚构资料的最小复现和必要错误码。不要为复现未知结果重复真实提交。

Use the [Bug template](https://github.com/mhl88510/maxiaojian-publish/issues/new?template=bug_report.yml) with the version/public commit, installation method, OS/Node/npm/Ego versions, a minimal fictional reproduction, and relevant error codes. Never repeat an uncertain real submission just to reproduce it.

不要贴 Cookie、密钥、令牌、浏览器 profile、真实账号配置、完整回执/日志、私人路径、业务素材或学生/客户资料。不要上传未经检查的截图或附件；无法脱敏就只描述错误类型，不在公开 issue 粘贴原件。

Do not paste cookies, keys, tokens, browser profiles, real account configuration, complete receipts/logs, private paths, business media, or student/customer data. Do not upload unchecked screenshots or attachments. If material cannot be sanitized, describe the error type rather than posting the original in a public issue.

提交代码改动前，在无真实账号与素材的环境运行现有离线检查。安装依赖会访问 npm；测试使用合成对象。不要把真实发布放入测试、CI 或复现示例。

Before contributing code, run the existing offline checks without real accounts or media. Dependency installation accesses npm; tests use synthetic objects. Do not add live publication to tests, CI, or reproductions.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

本项目的离线 CI 只验证所列 OS/Node 组合中的安装和合成检查；即便全部通过，也不等于各系统已完成真实账号上传或发表验收。

Offline CI checks installation and synthetic behavior on its listed OS/Node combinations. Passing every job does not establish live-account uploads or publication on those systems.

Unix 文件权限位检查只适用于 POSIX 系统；Windows ACL 隐私权限未由本项目验证。 / Unix mode-bit assertions apply only to POSIX systems; this project has not verified Windows ACL privacy.

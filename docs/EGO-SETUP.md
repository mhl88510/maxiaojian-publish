# Ego 依赖与绑定 / Ego setup and bindings

[中文首页](../README.md) · [English README](../README.en.md)

## 获取兼容环境 / Get a compatible environment

从 [Ego Lite 官方网站](https://lite.ego.app/)获取浏览器，并按[官方入门](https://lite.ego.app/document/en/docs/quick-start)完成安装、引导与 Agent 连接。它是独立依赖，本仓库不分发浏览器或登录态，也不使用维护者本机路径作为安装入口。

Get the browser from the [Ego Lite website](https://lite.ego.app/) and follow the [official quick start](https://lite.ego.app/document/en/docs/quick-start) for installation, onboarding, and connecting your agent. It is a separate dependency: this repository distributes neither the browser nor login state and does not depend on a maintainer-specific installation path.

| 项目 / Component | 要求与已验范围 / Requirement and verified scope |
| --- | --- |
| Node.js | 包要求 22+；本机验证使用 24.19.0。 / The package requires 22+; local checks used 24.19.0. |
| Ego Lite | 本次整理核对的 macOS 版本为 0.6.0.16。尚未建立更低版本或其他版本的兼容矩阵。 / The macOS version inspected for this extraction was 0.6.0.16. No minimum-browser-version or other-version compatibility matrix has been established. |
| Ego CLI/API | 对应使用指南为 v2.1.0（指南版本，不是浏览器版本）。需支持 `ego-browser nodejs` 以及 `profiles()`、`listTaskSpaces()`、`taskSpace()`、TaskSpace/Page API；以自己安装版本的帮助为准。 / The inspected guide is v2.1.0, a guide version rather than the browser version. The runtime must support `ego-browser nodejs`, `profiles()`, `listTaskSpaces()`, `taskSpace()`, and the TaskSpace/Page API. Consult the help matching your installed version. |
| 系统 / OS | 原版与本次安装验证为 macOS；Linux/Windows 的真实浏览器发布未验收；离线矩阵结果见 GitHub Actions。 / The original runtime used macOS; live browser publishing on Linux/Windows has not been verified. See GitHub Actions for offline matrix results. |

完成官方引导后，在 Bash/Zsh 中检查命令并读取本版本指南。仅表示工具可发现，不代表平台已登录或账号正确。命令缺失时回到官方引导，不要用同名第三方程序替代。

After official onboarding, check command discovery and read the matching guide in Bash/Zsh. These checks do not establish platform login or account identity. If the command is unavailable, return to the official setup rather than installing an unrelated program with the same name.

```sh
command -v ego-browser
ego-browser skill
```

## 只读取得绑定 / Obtain bindings with read-only commands

以下是安装者在自己的授权环境中执行的示例，不会上传、编辑、保存草稿或发表。不要照抄工作空间 ID 或猜账号；记录属于自己的目标，并将结果仅保存在私有配置中。不要将输出贴到公开 issue。

Run these examples only in your own authorized environment. They do not upload, edit, save drafts, or publish. Do not copy an example space ID or guess an account: identify your own destination and keep the resulting bindings in private configuration. Do not post the output in a public issue.

### 1. Profile

仅在明确选择要使用的浏览器 profile 时调用 `profiles()`，从返回记录取得对应的 profile ID。`profileId` 是创建工作空间时的参数；给已有空间传入另一个 profileId 不会切换它的账号。准确工作流可用 `help('profiles')`、`help('taskSpace')` 查看。

Call `profiles()` only when explicitly selecting the browser profile to use, then take that profile's ID from the returned records. `profileId` applies when creating a space; passing another profileId to an existing space does not switch its account. Use `help('profiles')` and `help('taskSpace')` for the exact workflow.

```sh
ego-browser nodejs <<'JS'
console.log(JSON.stringify(await profiles(), null, 2));
JS
```

### 2. TaskSpace

从 `listTaskSpaces()` 的目标记录取得 `id` 与 `name`，分别填入 `ego.taskSpaceId` 与 `ego.taskSpaceName`。注意列表记录使用 `id`，工作空间句柄使用 `spaceId`。需确认空间归属为 `agent`，并核对所选 profile；不要自动接管用户或其他任务的空间。还没有发布工作空间时，先按官方指南建立自己的任务并取得其 ID，再回到这里绑定。

Use the selected record's `id` and `name` from `listTaskSpaces()` as `ego.taskSpaceId` and `ego.taskSpaceName`. List records use `id`; a TaskSpace handle uses `spaceId`. Verify agent ownership and the selected profile. Do not automatically claim user-owned spaces or another task's space. If you have no publishing space, first establish your own task through the official guide and obtain its ID, then return here to bind it.

```sh
ego-browser nodejs <<'JS'
console.log(JSON.stringify(await listTaskSpaces(), null, 2));
JS
```

### 3. Page 与 target / Page and target

将下面的 `123` 改成上一步已确认、由 Agent 控制的空间 ID。`tabs()` 中已管理页面的 `label` 对应 `ego.pageLabel`，`targetId` 对应当前 `ego.targetId`。没有 label 的 tab 不能猜成 p1；按官方 Page 管理流程处理。代码只列出已管理页的标签和目标，不读取页面正文、凭据或 Cookie。

Replace `123` below with the confirmed agent-owned space ID. For a managed page, its `label` from `tabs()` maps to `ego.pageLabel`, and `targetId` maps to the current `ego.targetId`. Do not assume an unlabeled tab is p1; use the official Page-management workflow. This code lists only managed-page labels and targets, not page bodies, credentials, or cookies.

```sh
ego-browser nodejs <<'JS'
const id = 123;
const entry = (await listTaskSpaces()).find(space => space.id === id);
if (!entry || entry.ownership !== 'agent') throw new Error('EXACT_AGENT_SPACE_REQUIRED');
const task = await taskSpace(id);
const tabs = await task.tabs();
console.log(JSON.stringify(tabs.filter(tab => tab.label).map(tab => ({
  pageLabel: tab.label,
  targetId: tab.targetId
})), null, 2));
JS
```

`targetId` 不是永久标识，不应跨轮次假设稳定。页面关闭、重建或目标变化后，要重新观察并核对；现有绑定不匹配应停止。不要篡改旧任务回执以绕过去重或恢复校验。空间与页面 ID 本身也不是平台账号 ID：还需人工确认当前页面是自己的目标账号，并由发布器运行身份预检。

`targetId` is not a permanent identifier and must not be assumed stable across rounds. Observe and verify again after a page is closed, recreated, or changes target; stop if an existing binding no longer matches. Do not alter old receipts to bypass deduplication or recovery checks. Space/page identifiers are not platform account IDs: confirm that the page belongs to your intended account and let the publisher run its identity preflight.

## 最后检查 / Final check

填好私有账号矩阵后，按 [配置说明](CONFIGURATION.md)设置环境变量，使用自己的平台与 key 执行 `--account-status`。其结果才是对应目标的账号预检，不等同于发表、平台资质、全部媒体门禁或所有平台端到端验收。遇到登录、权限、验证码、用户控制或身份不明，停止并由本人处理。

After filling your private account matrix, set the environment variables described in [configuration](CONFIGURATION.md), then run `--account-status` with your own platform and key. Its result is an account preflight for that destination, not publication, platform eligibility, all media gates, or end-to-end verification of every platform. Stop for login, permissions, verification challenges, user control, or ambiguous identity and let the account owner handle them.

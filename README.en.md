# maxiaojian-publish

[简体中文](README.md) · English

**An Ego Lite–based CLI for multi-platform, multi-account video and article publishing, with an optional Agent Skill.**

It connects uploads, editor preparation, drafts, final submission, and result readback into a traceable workflow. This project is based on a publisher the maintainer has tested and continues to use. The standalone distribution retains real publishing capabilities alongside identity checks, single-submission guards, and reconciliation before retrying uncertain results.

[Install](#installation) · [Configure your accounts](docs/CONFIGURATION.md) · [Platform capabilities and limits](docs/SUPPORT.md)

## Who it is for

- Creators and content teams already using Ego Lite who want a CLI workflow for multiple platforms and accounts.
- Developers who need to verify the destination account, source media, and outcome of a submission.
- Maintainers who want to integrate, modify, or extend native platform adapters in their own environment.

This is a local tool that requires configuration. You provide your own accounts, content files, and authorized browser sessions. The repository supplies no login state and does not decide what you may publish or who owns the content rights.

## CLI and optional Agent Skill

The CLI is the execution core. The included [maxiaojian-publish Skill](skills/maxiaojian-publish/SKILL.md) describes the invocation order, authorization boundaries, and readback requirements for agents that support `SKILL.md`. It does not replace the CLI, browser, or account configuration.

Install the CLI first. To use it through an agent, provide the repository path and Skill entry, then load the skill according to your client's rules. Resolve the README/docs paths mentioned by the Skill from this repository. Installing the npm package does not automatically register the Skill with every agent client; copying SKILL.md alone does not install the runtime environment.

## Capabilities

- **Video and article publishing:** prepare content through native creator interfaces; create drafts, submit, and read back results on supported paths.
- **Explicit destination binding:** verify the platform account, Ego workspace, page, and identity instead of guessing from page position.
- **Media binding:** use media fingerprints, cover receipts, and preparation evidence to check content belonging to the same job.
- **Single submission:** submission reservations and final-click guards prevent duplicate attempts. Retain records and reconcile first when the result is uncertain.
- **Offline development:** check changes with fictional content, mock adapters, and contract tests without connecting real accounts.

Real write operations require an explicit `--execute`. Depending on the platform and action, this permits uploads, editing, draft saving, or publication for that invocation.

## Platform scope

| Platform | Available code paths | Limits |
| --- | --- | --- |
| Douyin, Xiaohongshu / RED, WeChat Channels, Bilibili | Video preparation, final submission from the specified PREPARED state, and readback | Require each platform's account, media, and cover evidence. Readback does not always establish public-page visibility. |
| Zhihu, Sohu, Toutiao | Native article preparation, submission, and readback | Depend on the current editor and control contracts. Resuming an arbitrary saved draft is not guaranteed. |
| Weibo | Native text submission and readback | The original implementation is retained; no new live-publication claim is made for this distribution. |
| WeChat Official Accounts | API drafts, publication, and status reads | Also require the external Baoyu/AWS WeChat toolchain and your own API configuration. |
| YouTube | Original video upload/editor preparation | The unified final-publication backend does not cover YouTube. |
| Baijiahao, NetEase | Original management/readback paths; Baijiahao has a specific experimental write path | General article writes remain blocked by the original unverified-path guards. |

See [SUPPORT](docs/SUPPORT.md) for the full boundaries. Historical testing of the original publisher, offline tests of the standalone package, and compatibility with a currently logged-in account are different kinds of evidence. They must not be treated as interchangeable. Detailed support/configuration documents are currently in Chinese; the scope, prerequisites, and test limits are also stated here in English.

## Installation

Requirements:

- Git, Node.js 22+, and npm.
- An installed and connected [Ego Lite](https://lite.ego.app/) / `ego-browser` CLI with the TaskSpace/Page API used by the original publisher.
- ffmpeg and ffprobe for video processing.
- Your own account bindings, content files, and authorized session.

Ego Lite is a separate dependency and is not bundled. Follow the [official quick start](https://lite.ego.app/document/en/docs/quick-start) and this repository's [Ego setup guide](docs/EGO-SETUP.md) to install and connect your own tools. The inspected environment was macOS / Ego Lite 0.6.0.16 with CLI guide v2.1.0; no minimum-browser-version or other-version compatibility guarantee has been established. Complete onboarding. Use `command -v ego-browser` to check whether the command is discoverable, then `ego-browser skill` to read the guide matching your installed version. Neither command establishes that a target platform is logged in or that the account identity is verified.

The original runtime and the installation checks for this distribution used macOS. Live browser publishing on Linux and Windows has not been verified; see the [CI matrix](https://github.com/mhl88510/maxiaojian-publish/actions/workflows/offline.yml) for offline installation and synthetic checks. Ordinary Chrome or Playwright cannot directly replace the Ego API.

```sh
git clone https://github.com/mhl88510/maxiaojian-publish.git
cd maxiaojian-publish
npm ci --ignore-scripts --no-audit --no-fund
npm link --ignore-scripts
maxiaojian-publish --help
maxiaojian-publish --list
```

A successful `--help` or `--list` only establishes that the CLI runs and configuration can be read. It does not mean an account is ready or every platform can publish.

If the required runtime is already available, you can also use `npm install -g github:mhl88510/maxiaojian-publish`. This project has not been published to the npm registry. Do not assume a registry package with the same name is this repository's installation entry.

## First use

### 1. Configure your own destination

Copy `examples/accounts.json` to your private directory and replace the fictional account and Ego bindings. See the [Ego setup guide](docs/EGO-SETUP.md) for read-only ways to obtain `profileId`, `taskSpaceId`, `pageLabel`, and `targetId`. The example cannot be used for real publication as supplied.

```sh
mkdir -p my-private
if [ ! -e my-private/accounts.json ]; then
  cp examples/accounts.json my-private/accounts.json
fi
export SCHOOL_PUBLISHER_ACCOUNT_MATRIX="$(pwd)/my-private/accounts.json"
export VIDEO_PUBLISHER_CONFIG="$(pwd)/my-private/video-config.json"
node core/config.mjs onboard --source-dir /path/to/your/media --available-platform douyin
maxiaojian-publish --account-status douyin demo_owner
```

The copy step preserves an existing account file. Edit `my-private/accounts.json` to replace fictional values with your own bindings and replace `/path/to/your/media` with your media directory before running the configuration and account checks.

`demo_owner` must match the account key in your configuration. If identity does not match, the login has expired, or the workspace is not under authorized agent control, resolve that blocker first. Do not switch accounts to bypass it.

### 2. Prepare and check content

Use `examples/native-video.json` for the video format or `examples/native-article.json` for articles. Replace the files, content, and destination with your own, then check:

```sh
maxiaojian-publish /path/to/package.json --action check
```

### 3. Execute an authorized action and read back the result

For video, prepare first, then use the returned `preparedStatePath` for final submission:

```sh
maxiaojian-publish /path/to/package.json --action draft --execute --confirm-original-rights
maxiaojian-publish /path/to/package.json --action publish --prepared-state /path/to/state.json --execute
maxiaojian-publish /path/to/package.json --action status
```

`draft` may upload media, fill an editor, or save a draft. `publish` may make content public. Implemented article paths can use `--action publish --execute`, but continuation still requires the original backend's specific receipts and editor conditions. For WeChat Official Accounts, submit using the draft's `mediaId`, then read back using `publishId`.

Reconcile duplicate or uncertain results first. Do not delete locks/receipts, change titles, or switch backends to submit again.

See [configuration details](docs/CONFIGURATION.md) for article selectors, external WeChat tools, video readback routes, and configuration options. Runtime records use the separate `~/.maxiaojian-publish` directory by default rather than reusing the original production ledger.

## Try the workflow without connecting an account

```sh
maxiaojian-publish init-demo ./demo
maxiaojian-publish simulate ./demo/package.json --state-root ./demo --execute
```

This creates a fictional package and operates on a local mock ledger. Example media contains placeholder bytes and must not be uploaded as real content. A successful simulation does not mean a platform published anything.

## Development and verification

The core uses Node.js / ES modules. Platform adapters and account constraints are in `core/`, packaging/mock helpers in `lib/`, and fictional configuration in `examples/`.

```sh
npm run check
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

Version 0.1.0 passed 188 Node tests, 11 Python tests, and clean-install checks locally. The public repository uses a manually triggered offline workflow; see the [CI matrix](https://github.com/mhl88510/maxiaojian-publish/actions/workflows/offline.yml). Offline checks do not establish live-account publication or native-browser verification on every OS. The maintainer confirmed that the original publisher was tested and remains in use; this extraction did not publish to business accounts.

When changing adapters, check account identity, media binding, single submission, and uncertain-result handling as well as successful mock paths.

## Upgrading, uninstalling, and reporting bugs

Get fixed versions from [GitHub Releases](https://github.com/mhl88510/maxiaojian-publish/releases/tag/v0.1.0). See the [bilingual maintenance guide](docs/MAINTENANCE.md) for upgrades, uninstalling each installation type, retaining private configuration/ledgers, and sanitized bug reports.

---

MIT · Maintainer [mhl88510](https://github.com/mhl88510) · [Project license](LICENSE) · [Upstream MIT notice](LICENSE.upstream-MIT)

Customized from [oil-oil/video-publisher-skill](https://github.com/oil-oil/video-publisher-skill), with applicable copyright notices retained. Account mappings, login state, business media, old receipts, and original business-repository history are not distributed. Before sharing runtime output, check for account identifiers, content IDs, and local paths. See [privacy guidance](docs/PRIVACY.md).

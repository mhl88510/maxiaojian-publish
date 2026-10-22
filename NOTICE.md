# Copyright and component sources

maxiaojian-publish is developed and maintained by mhl88510. Project contributions: Copyright (c) 2026 mhl88510, MIT; see [LICENSE](LICENSE). This notice identifies bundled component overlap; it does not describe the entire project as a customized edition of another repository or establish exclusive authorship of every file.

## Identified component overlap

The comparison reference is [oil-oil/video-publisher-skill at b615eacfbd41dde0e268e7e2a52fe6bd69011409](https://github.com/oil-oil/video-publisher-skill/tree/b615eacfbd41dde0e268e7e2a52fe6bd69011409), under `video-publisher/scripts/`. The corresponding distribution files are listed below. The reference repository carries Copyright (c) 2026 oil-oil, MIT; its complete notice is retained unchanged in [LICENSE.upstream-MIT](LICENSE.upstream-MIT) for applicable shared code.

| Bundled files | Verified scope |
| --- | --- |
| `core/lib/media.mjs`, `core/v2/lib/cli-args.mjs`, `core/v2/lib/identity.mjs`, `core/v2/lib/job-store.mjs`, `core/v2/lib/scheduler.mjs`, `core/v2/platforms/youtube.mjs` | Complete-file byte matches to the pinned reference. |
| `core/config.mjs`, `core/lib/config.mjs`, `core/v2/lib/job-lock.mjs`, `core/v2/lib/platform-lock.mjs` | The pre-extraction files matched the pinned reference; this distribution adjusts paths, state-directory defaults or help text. |
| `core/v2/publisher.mjs`, `core/v2/run-platform.mjs`, `core/lib/content-package.mjs`, `core/v2/ego/core.mjs`, `core/v2/platforms/xiaohongshu.mjs`, `core/v2/platforms/dispatch.mjs`, `core/v2/platforms/wechat-channels.mjs`, `core/v2/platforms/douyin.mjs`, `core/v2/platforms/bilibili.mjs`, `core/v2/lib/spaces.mjs`, `core/v2/lib/result-line.mjs`, `core/v2/lib/model.mjs` | Corresponding pre-extraction files contain substantive implementation changes. Applicable shared portions retain the reference notice; this does not attribute the entire files or their additions to that repository. |
| `core/v2/tests/cli-args.test.mjs`, `core/v2/tests/cover-proof.test.mjs`, `core/v2/tests/final-guard.test.mjs`, `core/v2/tests/identity.test.mjs`, `core/v2/tests/platform-lock.test.mjs`, `core/v2/tests/result-line.test.mjs` | Complete-file byte matches in bundled tests. |

Matching content and retained Git history establish overlap, not the first author, direction of copying or absence of a common source. The maintainer explains that the reference was inspected to learn how to connect Ego Lite; that explanation does not negate the verified component matches. The first author and any common source remain unconfirmed where the available records are insufficient. Calling Ego Lite's official APIs alone is not evidence of copying a third-party publisher implementation.

This distribution includes multi-account dispatch, native platform backends and portable content compilation helpers maintained by mhl88510. It does not claim that all distributed code has been proven independently original. Historical production testing belongs to the original installation; extraction and packaging checks do not imply fresh live publication from this distribution.

## External dependencies

Dependencies retain their own licenses; see [docs/THIRD-PARTY.json](docs/THIRD-PARTY.json) and installed package notices. Ego Lite, optional OpenCLI, ffmpeg/ffprobe and external WeChat toolchains are not bundled or relicensed by this project. Install their supported distributions separately.

## Distribution privacy

Account-specific incident scripts, original private repository history, runtime state and business content are excluded. This privacy boundary is separate from component attribution; see [docs/PRIVACY.md](docs/PRIVACY.md).

# 原生配置

## 账号

`SCHOOL_PUBLISHER_ACCOUNT_MATRIX` 指向私有 JSON；示例 `examples/accounts.json`。每个平台的 accounts 数组使用唯一 key，name/id 为平台可见身份。Ego 的 profileId、taskSpaceId/name、pageLabel、targetId 必须对应现有、已授权 Agent 控制的页面。账号名和 ID 不符、重复 key、目标改变都会拒绝；不要把默认示例当成真实绑定。

`VIDEO_PUBLISHER_CONFIG` 为 core/config.mjs 生成的配置。使用 `node core/config.mjs onboard --source-dir <媒体目录> --available-platform <平台>`；这仅写指定本地配置，不登录或发帖。`--platform` 可设置默认平台，`--originality-policy ask_each_run` 保留逐次原创确认。可选 `VIDEO_PUBLISHER_V2_EGO_COMMAND` 指定兼容官方 Ego CLI，不是任意浏览器替代协议。

原生包包含 schoolAccount.platform/accountKey、title、description 和 videoPath/coverPath 或 articlePath/body。路径由运行机器解析；建议使用绝对路径。视频自定义封面还需要原版定义的封面/准备凭据，缺少证据不会假装通过。编包辅助函数位于 lib/wrapper，纯离线编包保护不会替用户确定版权或业务授权。

## 文章

已附脱敏的原版通用文章控件合同 config/article-contracts.json，保留原生 selectors 和平台规则，排除验收记录、账号和个案。页面发生变化时用 MAXIAOJIAN_ARTICLE_CONTRACTS 指向经自己核对的合同；不要为通过测试删除门禁。知乎也可使用包内 pageContract：editorUrl、editorPathPattern、titleSelector、bodySelector、publishSelector，以及原生合同要求的字段。可用 MAXIAOJIAN_ARTICLE_CONTRACTS 指向自己的 registry（platforms 下按平台键），不要覆盖已发表文章来测试。搜狐、头条走保留的专用原生路径；网页变动需要先读回更新合同。样例 selectors 只示意结构，安装者必须核实自己的编辑器，不能据样例直接点击。

## 公众号 API（外部依赖）

设置 MAXIAOJIAN_WECHAT_ROOT，目录须具备原版接口：

- skills/baoyu-post-to-wechat/scripts/wechat-extend-config.ts（loadWechatExtendConfig、resolveAccount、loadCredentials）
- skills/baoyu-post-to-wechat/scripts/wechat-api.ts
- skills/aws-wechat-article-publish/scripts/publish.py 与 getdraft.py
- 自己的本地 aws.env 中 WECHAT_<slot>_APPID / WECHAT_<slot>_APPSECRET，与 Baoyu alias 配置交叉一致。

运行时需要 bun、python3，以及这些外部项目自己的依赖和许可证。账号映射中的 wechatApi.alias/slot 与 name 对应安装者账户。软件只在本地比较凭据，不返回凭据值。check 只验证本地交叉对应，不声称远端身份已验证。IP 白名单、账号权限、原创声明仍按原版返回阻塞。仓库不分发这些外部项目、私有配置或凭据；未具备上述依赖则公众号 API 不可用，其他平台不受影响。

可选 MAXIAOJIAN_OPENCLI_PACKAGE 指向兼容 OpenCLI package 根目录，仅用于已有抖音读取适配器；不随包安装。默认缺少此依赖不会自动绕过到另一个账号。

## 视频状态读取路由

需要 OpenCLI 路由的 status 路径使用 MAXIAOJIAN_READBACK_ROUTES 指向私有 JSON，格式见 examples/readback-routes.json。其 profile、space、page、target、账号名、平台 ID、API UID 必须与账号矩阵逐项一致。示例全部虚构，target_id 用 32 位十六进制格式；不要将示例直接作为真绑定。抖音可使用 ego_creator_native 传输；可选 ego_opencli_adapter 还要求 MAXIAOJIAN_OPENCLI_PACKAGE。视频号有独立原生回读模块。未配置的读取路径返回明确阻塞，不猜账号。

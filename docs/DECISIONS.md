# 公开版决定

用户于 2026-09-30 确认 1B、2A、3A、4A、5A，本文件记录已经采用的选择。

- 云服务：继续使用现有 CloudBase 环境，面向该环境中符合服务端规则的账号，不限定某个用户名。客户端不创建、合并或导入账号，不绕过验证、账号状态或配额。
- 身份：使用新固定 ID `ohdenlpjdfngpaaggijhcagfpafecgdn`，与旧 ID `kcijljpopjgbfadpcbkcclfojhdihdcj` 并存。不同 ID 的本机存储独立；云端同一账号仍使用同一服务和数据。
- 字体：随包提供原版 DM Sans、Newsreader，保留 OFL 1.1 许可和来源哈希。
- 网站图标：按域名生成本地字母图标，不使用远程 favicon 服务。
- 内置 prompt：只分发许可证据明确的内容。复制来的 13 份暂缺证据，首版不内置；不删除已有笔记。
- 范围：只完成本地源码、安装 ZIP 和可完成的验收。在本项目根目录初始化独立 Git，分支 `codex/public-edition`，不继承原历史和 remote，不上传、不发布。

## 后续公开仓库授权

用户于 2026-09-30 追加授权：使用 `dengatlas` 创建公开仓库并推送本独立项目，供其他人访问。仓库为 [dengatlas/inner-garden](https://github.com/dengatlas/inner-garden)，工作分支为 `codex/public-edition`。此授权更新上面的本地交付范围；不包含 GitHub Release、商店提交或云服务来源规则修改。

## 云服务来源授权

初始无认证探测中，新 ID 请求账号资料接口得到 `403 ORIGIN_NOT_ALLOWED`；旧 ID 得到 `400 INVALID_AUTHORIZATION`。用户随后于 2026-09-30 明确选择 A，授权只追加新来源、保留现有来源，并只读核对目标账号身份；该授权不包括账号绑定、密码修改或数据迁移。

已经追加的确切来源：

```text
chrome-extension://ohdenlpjdfngpaaggijhcagfpafecgdn
```

已在环境 `dk-checkin-d8gw6jhrt5b2ced62` 的 `tab-out-sync` 函数中追加 `TAB_OUT_EXTENSION_ORIGIN`，原有 3 条来源全部保留。更新后回读确认只改变该变量，其余环境变量以及运行时、入口、内存、超时、代码指纹等配置保持不变，函数为 Active。没有部署代码、修改网关认证或写入用户数据。

2026-10-01 06:44 UTC 的更新后探测：新来源预检为 `204`，账号资料无 Token 请求为 `400 INVALID_AUTHORIZATION`，允许来源与新 ID 精确匹配；旧 3 条来源的预检均为 `204`，未授权的对照来源仍为 `403 ORIGIN_NOT_ALLOWED`。登录/验证码接口的空请求为 `400 INVALID_REQUEST`，没有发送验证码。工作区与 flomo 无凭据请求仍为网关 `401 MISSING_CREDENTIALS`，不能据此证明真实账号登录或同步已通过。

“所有账号可用”指现有环境中服务端允许的账号可登录，并各自访问自己的内容。当前桌面客户端支持用户名、邮箱或手机号配合密码，以及已验证手机号的登录流程；只拥有其他平台身份、尚未绑定桌面支持的凭据的账号，不能据此承诺直接登录。来源授权之后仍需用真实账号验证登录、工作区和 flomo 同步；公开注册是否启用、验证码发送规则、账号限制和服务容量由现有服务端决定，客户端不能承诺已全部开放。

当前来源探测可通过 `npm run probe:cloud` 重复执行。它不使用密码或 Token，不注册账号，不发送验证码，不写入工作区或笔记。结果留在被忽略的 `dist/cloud-probe.json`。

## 微信扫码登录可行性（尚未实施）

来源更新后只读查询确认，环境已有启用的 `WX_QRCODE_MICRO_APP` 身份源 `wx1ad466fd73a2ab9e`；当前手机微信快捷登录也使用该小程序 AppID 作为 provider ID。CloudBase 官方接口将该类型定义为微信小程序扫码登录，参见[登录配置](https://docs.cloudbase.net/api-reference/manager/node/login-config)。

桌面扩展当前只有密码及手机验证码界面，没有扫码入口。接入时优先评估现有小程序身份源，核对二维码获取、回调/会话交换、扩展后台写入及实际 UID；不能仅因同一微信、昵称或 AppID 就宣称已登录同账号。现有身份源允许自动注册，首次验证原账号时应避免新建用户；不在本轮改动此服务端策略。真实扫码、原 UID 一致和跨设备同步须分别验收。

本段仅记录用户提出的可行性问题及只读结果，未授权新增扫码功能、账号绑定、密码修改或额外远程服务改动。

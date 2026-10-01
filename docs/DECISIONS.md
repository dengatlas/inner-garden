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

## 云服务当前阻碍

2026-10-01 UTC 的无认证、无数据写入探测：新 ID 请求账号资料接口得到 `403 ORIGIN_NOT_ALLOWED`；旧 ID 得到 `400 INVALID_AUTHORIZATION`，说明旧来源被接纳而新来源被拒绝。工作区与 flomo 无凭据请求均得到网关 `401 MISSING_CREDENTIALS`，不能据此证明其账号权限或来源配置。

需要追加的确切来源：

```text
chrome-extension://ohdenlpjdfngpaaggijhcagfpafecgdn
```

维护者应在现有账号代理的来源白名单中追加此值并保留已有来源，再核对工作区、flomo 的来源策略。客户端错误提示已说明本机内容会保留。本轮没有修改远程服务配置。

“所有账号可用”指现有环境中服务端允许的账号可登录，并各自访问自己的内容。当前桌面客户端支持用户名、邮箱或手机号配合密码，以及已验证手机号的登录流程；只拥有其他平台身份、尚未绑定桌面支持的凭据的账号，不能据此承诺直接登录。来源授权之后仍需用真实账号验证登录、工作区和 flomo 同步；公开注册是否启用、验证码发送规则、账号限制和服务容量由现有服务端决定，客户端不能承诺已全部开放。

当前来源探测可通过 `npm run probe:cloud` 重复执行。它不使用密码或 Token，不注册账号，不发送验证码，不写入工作区或笔记。结果留在被忽略的 `dist/cloud-probe.json`。

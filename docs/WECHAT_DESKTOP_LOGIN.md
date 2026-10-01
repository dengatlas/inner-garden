# 桌面微信账号登录：实测与实施方案

## 当前实测

2026-10-01，本轮仅使用无用户凭据的请求检查服务能力，没有绑定账号、修改密码、注册用户或写入工作区。

- 现有 `WX_QRCODE_MICRO_APP` 身份源已启用，但 `POST /auth/v1/qrcode/generate` 返回 `400 failed_precondition`：当前环境不是微信云开发环境，无法使用扫码登录。因此，身份源开关不能作为二维码可用的证据。
- 原手机与新桌面使用的目标环境仍为 `dk-checkin-d8gw6jhrt5b2ced62`；不迁移环境或原用户。
- `POST /auth/v1/device/code` 使用环境 ID 作为 `client_id`、不追加 scope 时实测 `200`，返回 OAuth device flow 所需字段，有效期 300 秒。请求额外 scope 会被拒绝；保留现有默认授权范围。
- 2026-10-01 10:09 UTC，无手机授权的设备会话交换返回 `400 authorization_pending`；手机授权接口在无手机 Bearer 凭据时返回 `401 unauthenticated`。未取得任何真实用户会话。
- 桌面账号代理目前未开放 device flow 路由。网关直接接收 Chrome 扩展来源会被拒绝，因此准备了限定的[代理补丁](DEVICE_AUTH_SERVICE_CHANGE.md)，不扩大来源白名单。

依据为官方 `@cloudbase/js-sdk@3.10.1` 发布包中 `oauth/dist/auth/consts.d.ts` 和 `models.d.ts`：`deviceAuthorize` 获取挑战，`authorizeDevice` 由已登录用户确认授权，`grantToken` 交换设备会话。

## 推荐的最小方案

采用 CloudBase 已有 OAuth device flow，让手机当前登录的账号授权电脑。二维码只是传递授权编号；不依赖该环境不支持的原生小程序二维码生成接口，也不新建认证服务器。

1. 电脑获取设备挑战，仅后台持有 `device_code`；界面显示短时 `user_code` 和可扫描的授权编号。
2. 手机在原小程序账号页扫描或输入编号，显示当前 UID，并由用户确认“使用此账号登录电脑”。
3. 手机通过当前会话调用 `POST /auth/v1/user/device/authorize`，只提交 `client_id`、`user_code`。不传出手机 access/refresh token，不修改手机号、密码或微信绑定。
4. 电脑按服务端 interval 轮询 `POST /auth/v1/token`，`grant_type=urn:ietf:params:oauth:grant-type:device_code`。超时、拒绝、关闭、重新生成和账号变化均使旧挑战失效。
5. 电脑通过服务端会话/账号资料取得 UID，先展示“手机已授权，请核对账号”，用户核对后才保存登录并开始日程同步。目标 UID 不写入公开配置；任何用户都核对自己的账号。
6. flomo 保持独立、可选，并在日程验证之后验收。

手机扫码入口可放在现有账号页，不增加新小程序页面，也不需要改变首页启动逻辑。扫码内容只包含协议版本、目标环境和短时授权编号，不含 `device_code` 或任何 Token。

## 原小程序变更边界：已获三处最小改动授权

用户此前要求 `D:\tab-out\miniprogram` 只读，于 2026-10-01 明确允许以下三处最小改动，现已实现：

- `features/account/index.wxml`：授权电脑入口、编号输入和当前账号确认。
- `features/account/index.js`：扫码解析、确认/取消和显示结果。
- `utils/sync-service.js`：使用当前账号会话调用官方设备授权接口。

其他原项目文件保持原样，不引入独立仓库。没有修改账号密码、绑定、UID 或原数据。云端代码补丁单独请求部署授权；本地实现不等于实际手机已更新。

## 验收顺序

1. 实际扩展后台获取挑战、等待、取消、过期和重新生成；同机多页不能互相接收旧授权结果。
2. 手机真实确认后，桌面得到预期 UID；这一步需要用户操作手机。手机原登录保持可用，不创建新用户。
3. 日程/周计划/日课以专门标记的测试内容验证双向新增、修改、删除，再清理测试内容。
4. flomo 另行核对账号库并验证正文、标签与回收站；图片、草稿不跨设备传输。
5. 核对离线修改、冲突、账号切换及重新登录；自动检查与真实双设备证据分别记录。

公开源码推送、安装 ZIP、真实扫码验收和渠道发布仍分别记录状态；不以二维码界面完成代替真实登录通过。

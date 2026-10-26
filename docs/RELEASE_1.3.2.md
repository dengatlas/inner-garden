# Inner Garden · 美日心灵 1.3.2

本版修复手机授权登录兼容问题，保留本地编辑、现有账号与同步数据。

## 本版修复

- 按原始字符串传递授权编号，兼容大小写、下划线及其他可见字符。
- 二维码保留服务端签发的授权范围，供手机按原范围确认。
- 支持无刷新凭据的有效会话；按实际期限保存并提示，到期后重新授权。
- 授权等待、过期和账号核对失败提供明确反馈；用户核对 UID 后才保存登录并同步日程。

## 下载与安装

- [下载 inner-garden-1.3.2.zip](https://github.com/dengatlas/inner-garden/releases/download/v1.3.2/inner-garden-1.3.2.zip)
- [下载 SHA-256 校验文件](https://github.com/dengatlas/inner-garden/releases/download/v1.3.2/inner-garden-1.3.2.zip.sha256)

解压到准备长期保留的目录，打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，选中含 `manifest.json` 的解压目录。用户无需安装 Node 或编译源码。

已安装用户先备份重要内容，再将新包文件覆盖到原安装目录，在扩展管理页重新加载并重新打开新标签页。保留同一个 Chrome 个人资料和扩展 ID；卸载会删除本机存储。GitHub 下载版需手动更新。

## 使用与验证范围

本机编辑无需登录；可选云同步沿用现有 CloudBase 服务，适用账号、注册和验证码能力由服务端规则决定。flomo 与专注记录同步各自保留单独开关。同步使用 HTTPS，服务运营方可接触同步明文。

自动化测试、隔离 Chrome 安装包检查与真实同 UID 服务交换的证据分别保留。用户已确认自己电脑的实际桌面登录及部分数据同步成功；未逐项说明的数据类别、方向及新增／修改／删除覆盖不计为已验收。详细结果见[验收记录](https://github.com/dengatlas/inner-garden/blob/v1.3.2/docs/ACCEPTANCE.md)。

安装包按白名单生成，排除本机配置、登录凭据、私人导出和浏览器资料，保留许可证和隐私说明。此次发布沿用既有云服务配置；安装方式为解压加载，未提交 Chrome 扩展商店。

[安装与迁移](https://github.com/dengatlas/inner-garden/blob/v1.3.2/docs/INSTALL.md) · [隐私说明](https://github.com/dengatlas/inner-garden/blob/v1.3.2/docs/PRIVACY.md) · [第三方许可](https://github.com/dengatlas/inner-garden/blob/v1.3.2/THIRD_PARTY_NOTICES.md)

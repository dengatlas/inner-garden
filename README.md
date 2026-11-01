# Inner Garden · 美日心灵

本地优先的桌面 Chrome 新标签页工作区：整理标签、管理稍后再看、专注计时、安排日历与周计划、记录日课和 flomo 笔记。

当前版本 **1.3.3**，公开源码仓库为 [dengatlas/inner-garden](https://github.com/dengatlas/inner-garden)。本版新增日程与日课版本历史、当天变更、差异比较和带版本校验的恢复；保留手机授权登录、账号专注记录、flomo 同步和本机备份。本机编辑无需登录。历史服务已单独上线，个人终端升级与三端完整互通的验收范围见[验收记录](docs/ACCEPTANCE.md)。

## 安装

从 [v1.3.3 发布页](https://github.com/dengatlas/inner-garden/releases/tag/v1.3.3)下载 `inner-garden-1.3.3.zip` 和 `.sha256` 校验文件。普通用户请选择安装 ZIP，GitHub 自动生成的 Source code 是源码包。

解压安装 ZIP，打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。源码目录安装请选择 `extension/`。无需 npm、Node 或后端部署。

从公开仓库点击 **Code → Download ZIP** 下载源码，解压后选择其中的 `extension/` 目录加载；仓库已包含生成后的运行文件。

公开版使用独立固定 ID，可保留旧版。Chrome 新标签页同时只有一个扩展生效；本机数据分开，同一云账号继续使用同一服务。先备份旧版，再按迁移说明导入；不要通过卸载旧版来更新或迁移。

- [安装、更新与迁移](docs/INSTALL.md)
- [数据与隐私](docs/PRIVACY.md)
- [专注记录与统计同步](docs/FOCUS_SYNC.md)
- [开发与打包](docs/DEVELOPMENT.md)
- [已确定的产品策略和云服务状态](docs/DECISIONS.md)
- [本地验收记录](docs/ACCEPTANCE.md)
- [手机授权电脑的流程与验收](docs/WECHAT_DESKTOP_LOGIN.md)
- [变更记录](CHANGELOG.md)
- [第三方素材说明](THIRD_PARTY_NOTICES.md)

字体随包提供，网站图标在本地生成。13 份旧内置 prompt 暂缺再分发证据，首版不内置；已有笔记不删除。认证、工作区和 flomo 是可选的云服务请求，不等于所有数据都会上传。

## 与小程序一起使用

1. 在手机美日心灵小程序保存记录，到“设置 → 数据与关于 → 数据同步”同步日程与日课。
2. 电脑插件顶部点“账号 → 手机微信授权”生成二维码；手机进入小程序“设置 → 账号与资料”，在“授权电脑”旁点“扫一扫”。请使用小程序内的按钮。
3. 两端核对同一 UID 后确认登录，在电脑同步并按相同日期核对一条日程。电脑修改后保存并同步，手机再同步即可接收；需要时也核对删除。
4. flomo 与已完成的专注记录各自开启账号同步。图片、草稿和进行中的计时留在原设备；可选自动同步约每 12 分钟在前台执行，手动同步可立即进行。

小程序“版本更新”提供电脑端安装与 AI 连接两份帮助。AI 与 MCP 可单独使用，无需先安装这个插件；当前 AI 开放日程、日课、周计划和 flomo 文字与标签，不开放专注历史。

完整安装、更新、账号有效期及常见问题见[安装说明](docs/INSTALL.md)。教程按 Windows Chrome 说明，其他平台的实测状态见验收记录。

## 维护

使用 Node 22 或更新版本；当前没有 npm 第三方依赖。根级 `shared/` 是 canonical 源码，`extension/shared/` 是生成副本。

```powershell
npm run build
npm run check
npm test
npm run package
```

安装包在本机 `dist/`，按白名单生成，不含 config.local.js、登录凭据、私人导出或测试个人资料。GitHub 下载版需手动更新，商店发布另行安排。

## 来源与许可

基于 Zara Zhang 的 Tab Out 继续开发，保留上游 MIT [LICENSE](LICENSE)。字体与图标分别保留适用许可。当前独立仓库没有继承旧 Git 历史或 remote。

## 1.3.3 记录历史

日程与日课保留最近两个不同旧内容，可查看当天移日期和删除的记录，比较后恢复为新版本。更新需覆盖原安装目录并重新加载扩展，GitHub 下载版不会自动升级。历史服务已上线，小程序仍需使用支持该功能的版本；个人终端及三端完整互通分别验收。详见 [记录历史说明](docs/RECORD_HISTORY.md)及 [1.3.3 发布说明](docs/RELEASE_1.3.3.md)。

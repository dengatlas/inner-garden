# Inner Garden · 美日心灵

本地优先的桌面 Chrome 新标签页工作区：整理标签、管理稍后再看、专注计时、安排日历与周计划、记录日课和 flomo 笔记。

当前版本 **1.3.2**，公开源码仓库为 [dengatlas/inner-garden](https://github.com/dengatlas/inner-garden)。本版修复手机授权码与授权范围兼容，支持按真实有效期保存无刷新凭据的会话；保留账号专注记录、flomo 同步和本机备份。本机编辑无需登录。用户已确认实际桌面登录与部分数据同步成功，具体证据范围见[验收记录](docs/ACCEPTANCE.md)。

## 安装

正式发布后，可从 [v1.3.2 发布页](https://github.com/dengatlas/inner-garden/releases/tag/v1.3.2)下载 `inner-garden-1.3.2.zip` 和 `.sha256` 校验文件。发布状态以该页面为准。

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

## 1.3.3 本地候选

本分支的 1.3.3 候选加入日程与日课版本历史、当天变更、带校验的恢复及跨端增量保存保护。公开正式下载仍为上方 v1.3.2；新历史服务部署、候选安装和小程序发布分别验收。详见 [记录历史说明](docs/RECORD_HISTORY.md)。

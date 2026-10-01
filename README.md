# Inner Garden · 美日心灵

本地优先的桌面 Chrome 新标签页工作区：整理标签、管理稍后再看、专注计时、安排日历与周计划、记录日课和 flomo 笔记。

当前版本 **1.2.0**，是已在本地整理的公开版候选，尚未上传或发布。保留原 CloudBase 服务；新扩展 ID 尚需账号服务来源授权，云登录和真实账号同步未通过验收。本机编辑无需登录。

## 安装

解压安装 ZIP，打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。源码目录安装请选择 `extension/`。无需 npm、Node 或后端部署。

公开版使用独立固定 ID，可保留旧版。Chrome 新标签页同时只有一个扩展生效；本机数据分开，同一云账号继续使用同一服务。先备份旧版，再按迁移说明导入；不要通过卸载旧版来更新或迁移。

- [安装、更新与迁移](docs/INSTALL.md)
- [数据与隐私](docs/PRIVACY.md)
- [开发与打包](docs/DEVELOPMENT.md)
- [已确定的产品策略和云服务状态](docs/DECISIONS.md)
- [本地验收记录](docs/ACCEPTANCE.md)
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

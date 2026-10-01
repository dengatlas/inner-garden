# 独立开发

运行文件位于 `extension/`；canonical 共享源码位于根级 `shared/`。只编辑 canonical 文件，运行 `npm run build` 生成 `extension/shared/`。不要执行原项目的多端构建。

维护工具使用 Node 22 或更新版本及 Git。当前无 npm 第三方依赖，安装扩展的用户不需要这些工具。

```powershell
npm run build
npm run check
npm test
npm run package
git diff --check
```

构建只写本项目的 `extension/shared/`；检查语法、文件引用、版本与固定身份、配置、字体哈希、文档链接和生成副本。行为测试覆盖工作区重放/账号隔离、离线保留、flomo 删除与分块、迁移和打包边界。打包使用明确白名单及 Node 内置 ZIP 实现，不压缩整个开发目录。

发行包和哈希在被忽略的 `dist/`。ZIP 内 `manifest.json` 位于根目录，解压后直接加载。每次最终代码或许可变更后重建并重验包。

## 配置

`config.js` 是公开默认；`config.local.js` 是被忽略的可选本机覆盖。维护者需在自己的 checkout 明确将 `TAB_OUT_LOAD_LOCAL_CONFIG` 设为 true，后台才会加载它；检查与打包前必须恢复 false。公开默认不探测缺失的本机文件，页面从后台读取白名单中的公开配置字段。`config-finalize.js` 固定 12 分钟间隔。完整示例包含认证、工作区、flomo 三个接口。

私人配置永不进入 Git 或 ZIP。发布检查不能依赖本机覆盖，必须针对解压后的包进行。新服务域名须符合 manifest 可选权限，不随意扩大权限。

## 数据与协调

保留既有存储键和 schema-v3。`workspace-background.js` 串行处理工作区及账号写入；页面发送相对快照的变化。flomo 使用独立后台队列。保留草稿、账号隔离、备份与上海时区。设备导入也必须经过后台，避免多页写入覆盖。

## 浏览器验收

在全新测试个人资料中安装解压后的 ZIP，记录浏览器版本、实际操作、控制台和网络结果。自动检查、真实浏览器验收、云账号验收、实际公开发布分别记录。使用合成内容，测试个人资料和原始日志不进入 Git。

## 版本与历史

同步修改 manifest、package.json、策略记录和 CHANGELOG。固定 ID 记录在 `docs/decisions/public-edition.json`。保留历史 COPY_BASELINE；开发后的历史哈希不匹配是预期结果，不覆盖它。

当前分支为 `codex/public-edition`，没有 remote。不自动上传、不继承旧 Git 历史。公开仓库地址与发布渠道由用户另行指定。

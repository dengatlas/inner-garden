# 本地验收记录

版本：1.2.0。源码公开于 [dengatlas/inner-garden](https://github.com/dengatlas/inner-garden)；未发布 GitHub Release 或提交扩展商店。下述浏览器和云服务证据仍按各自验收范围记录。

## 开始状态

原样副本核验：30 个文件、632,249 字节均匹配历史 SHA-256 基线。独立开发后的历史差异是有意变更，COPY_BASELINE 保持原样。

## 自动检查

2026-10-01 UTC，Windows 本地执行：

- `npm run build`：8 个 canonical 共享模块生成成功，仅写本项目 `extension/shared/`。
- `npm run check`：41 个 JavaScript 语法检查、38 个本地资源引用、固定 ID、配置、字体哈希、生成副本和文档链接通过。
- `npm test`：26/26 通过。覆盖多页写入、账号切换隔离、离线队列/备份、草稿日期边界、同步范围、远端删除重放、自动同步节流、flomo 删除/分块/快照、无内置 prompt、本地图标、迁移防覆盖及 ZIP/配置边界。
- `npm run package`：42 个白名单文件，`manifest.json` 位于 ZIP 根目录，包含运行文件、安装说明、隐私说明及适用许可。
- Python 标准库 `zipfile` 独立检查 ZIP CRC、条目清单及内容；解压后用于下述 Chrome 验收。
- Git 排除个人配置、历史交接/基线、安装包、导出、测试个人资料和自动化日志。OFL 许可保留上游原始字节。

最终安装包的 SHA-256 与逐文件清单分别位于本机 `dist/inner-garden-1.2.0.zip.sha256` 和 `dist/release-files.json`。这些产物不进入 Git。

## 浏览器

使用本机正式安装的 Google Chrome **154.0.8037.59**，由 Playwright CLI 驱动 headless Chrome，在全新独立个人资料中通过 Chrome DevTools Protocol 加载解压后的 ZIP。没有替换用户正在使用的浏览器个人资料。测试内容均为合成内容，未登录云账号。

| 操作 | 实测结果 |
| --- | --- |
| 安装与新标签页 | 版本 1.2.0；ID `ohdenlpjdfngpaaggijhcagfpafecgdn`；开启开发者模式后重新加载可用；`chrome://newtab` 打开本扩展 |
| 离线编辑 | 断网时保存 flomo 笔记成功；未授予任何云域名权限也能使用本机功能 |
| 标签整理 | 本地模拟页面按域名分组、关闭重复标签、保存稍后再看，实际 Chrome 标签与存储相应变化 |
| 专注 | 开始、暂停，暂停状态及剩余时间保存 |
| 日历 | 创建时间块、编辑标题与内容、拖动、调整时长；存储从 09:30–09:45 变为 10:30–11:15；切周返回保留 |
| 周计划与日课 | 添加周计划、生成日志；两页同时编辑不同日课字段，两份修改均保留 |
| 备份与导出 | 工作区备份、日课 JSON/Markdown、flomo JSON 下载成功；实际读取导出内容核对 |
| flomo | 保存、删除到回收站、恢复；页面刷新后未保存草稿恢复 |
| 设备迁移 | 自动初始化的空工作区和默认标签允许导入；已有内容拒绝再次导入，日历内容保持不变 |
| 后台恢复 | CDP 强制停止 MV3 worker 后，工作区初始化请求唤醒后台并返回原内容 |
| 浏览器重启 | 关闭并重新启动同一测试个人资料：时间块、周计划、四个日课字段、笔记、草稿、稍后再看和暂停计时保留 |
| 资源与错误 | 三个本地字体面均 loaded；新标签页 HTTP(S) 资源请求列表为空；页面控制台 0 error/0 warning；扩展管理页 runtimeErrors/manifestErrors 均为 0，状态 ENABLED |

验收过程中修复了两个实际问题：Chrome 存储对象键排序导致空安装迁移误判，以及后台探测缺失 `config.local.js` 产生扩展错误。前者有行为回归测试，后者通过显式关闭私人配置加载并重新安装包核验。

1440 像素宽的实际浏览器截图：[日课](screenshots/daily-1440.png)、[日历](screenshots/calendar-1440.png)。截图只含合成验收内容。页面日期按上海时区显示；测试记录使用 UTC。

本轮不是人工可见窗口验收。系统权限弹窗的实际批准/拒绝、旧用户个人资料的真实数据迁移、后续版本升级保留数据，以及不同操作系统仍待验收。

## 云服务

初始无认证探测中，新账号来源为 `403 ORIGIN_NOT_ALLOWED`，旧来源得到 `400 INVALID_AUTHORIZATION`。

用户于 2026-09-30 授权追加新来源。执行后回读确认：只改变 `tab-out-sync` 的 `TAB_OUT_EXTENSION_ORIGIN`，原 3 条来源、其余环境变量及代码/运行配置全部保留；函数 Active。

2026-10-01 06:44 UTC 更新后实测：新来源及原有 3 条来源的账号登录预检均为 `204`，返回各自精确允许来源；未授权对照来源仍为 `403 ORIGIN_NOT_ALLOWED`。新 ID 的账号资料无 Token 请求为 `400 INVALID_AUTHORIZATION`，登录/验证码接口空请求为 `400 INVALID_REQUEST`。工作区和 flomo 无凭据请求仍为网关 `401 MISSING_CREDENTIALS`。

此次使用已授权管理连接只读核对目标账号的登录标识，不把个人账号资料写入公开文档。真实账号登录、注册、验证码、工作区双设备同步、flomo 同步及账号隔离的服务端验证仍未执行；没有绑定/解绑账号、修改密码、发送验证码或写入原云内容。

本地证据为被忽略的 `dist/cloud-origin-change.json`、`dist/cloud-origin-preflight.json` 和 `dist/cloud-probe.json`。安装包仅因安装说明更新而重建；运行文件保持原样。

## 发布

用户于 2026-09-30 授权创建公开仓库并推送本独立项目，`origin` 为 `https://github.com/dengatlas/inner-garden.git`，公开分支为 `codex/public-edition`。推送前工作区干净，历史仅包含本独立项目的初始提交；77 个已跟踪文件的私人路径和常见凭据模式检查无匹配，个人配置与历史交接材料仍被 Git 忽略。

没有 GitHub Release 或商店提交。公开源码不代表云账号验收通过。Edge/macOS/Linux 不在本轮实测结论内。

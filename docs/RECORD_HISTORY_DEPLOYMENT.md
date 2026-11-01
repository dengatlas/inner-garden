# 记录历史服务上线验收 — 2026-11-01

## 已上线范围

经本次会话授权，2026-11-01 23:28（Asia/Shanghai）仅更新国内上海环境 `dk-checkin-d8gw6jhrt5b2ced62` 的现有 Event Function `tab-out-sync` 代码。函数状态 `Active`，入口 `index.main`、运行时 `Nodejs20.19`、内存 256 MiB、超时 30 秒保持原值。未发布小程序、GitHub Release 或其他服务。

仅新增 `workspace_record_history` 集合及以下三个索引：

- `workspace_record_history / owner_date_sort`：`ownerUid ASC, kind ASC, dateKey ASC, sortKey DESC`。
- `sync_changes / owner_entity_history`：`ownerUid ASC, entityType ASC, entityId ASC, revision DESC`。
- `sync_changes / owner_date_history`：`ownerUid ASC, payload.dateKey ASC, revision DESC`。

通过管理 API `DescribeResourcePermission` 核实新集合为 `ADMINONLY`；通过 `DescribeTable` 核实三个索引的字段、方向与既有索引保留。未设置 TTL。

## 配置与备份

部署前下载完整线上代码、函数配置及 8 个工作区集合快照。快照 SHA-256：`27aa3a8df77e0b3300f3444effe024297e8c5c10e48f84f56b407efc7c3ddc83`。私有备份保存在本机 `C:/Users/RainbowAtlas/.codex/private-recovery/inner-garden-20261101/cloud-history-deploy`，不进入 Git 或安装包。

本地 `auth-proxy.js` 含本次范围外的改动，部署候选直接使用部署前线上原文件；既有 `http-request.js`、`agent-admin.cjs`、`package.json` 也保持线上内容。仅替换 `index.js`、`core.js`、`cloudbase-repository.js` 并新增 `record-history.js`。部署后重新下载线上 8 个运行文件，逐个 SHA-256 与候选一致。

通过前后函数详情比较，除代码元信息、修改时间和请求标识等易变字段外，其余字段逐项相同，包括运行时、环境变量、触发器、网络、身份与来源配置。未执行域名、认证、网关或合法域名修改命令。此次操作使用代码更新命令，没有执行函数配置更新或全环境部署。

## 真实云端验证

通过已授权管理面调用现有函数，使用独立随机测试 owner，经过真实 CloudBase 数据库事务完成 15 项检查：

1. `/status` 返回 `recordHistory: {previousVersions: 2, restore: true}`，保留 `focus_session` 能力。
2. 未鉴权历史请求返回 401。
3. 连续四次不同编辑保留当前及最近两个不同旧内容。
4. 相同内容不增加历史名额。
5. 较晚上传的较旧编辑不覆盖新内容。
6. 旧基线上的较新有效编辑可以胜出。
7. 过期恢复预览返回 409，成功恢复的重复请求返回原收据。
8. 恢复之后再次编辑，重试旧恢复请求不会覆盖后续编辑。
9. 另一账号无法读取历史或恢复已知历史 ID。
10. 移出日期、删除记录均能从相关日期找到。
11. 旧快照不能复活墓碑，明确历史恢复可以恢复已删除记录。
12. 手机、Ego、Chrome 各自新增取并集，日课字段独立保留旧内容。
13. 分页无重复、游标绑定账号，历史改变后旧游标返回 409。
14. 函数状态与部署前配置保持一致。
15. 新集合权限为 `ADMINONLY`。

测试完成于 23:32。只清理两个精确随机测试 owner 的数据，清理前保存私有证据并逐条校验归属；清理后确认相关集合残留为零。原有 6 个工作区的元数据与部署前快照完全一致。

另外调用真实已恢复时间块的历史接口，确认 `event-1793527783955` 当前日期仍为 `2026-11-01`，正文、时间、颜色及版本均与部署前一致；惰性回填找到一个日期为 `2026-10-31` 的旧版本。此步骤没有恢复或修改当前记录。

这些结果是线上函数、数据库事务及历史回填验收。管理面调用不等同于用户三端 UI、网关登录和真机完整增删改验收。

## 客户端交付与剩余验收

- 独立扩展源码提交 `a0b64f7`，本地候选 `inner-garden-1.3.3.zip`；SHA-256 `4bf6d2cfbf6befcc81eb82885cbfce1881781b18dc549ef19ba9a2108d819640`。候选在本次部署前已通过 build/check、123 项测试和隔离 Chrome ZIP 验证，正式 1.3.2 包保留。本次没有替换候选包内容；其中说明记录的是部署前验收状态，最新云端状态以本文件为准。
- 小程序、共享协议与服务端源码提交 `526981d`。定向检查及原生模拟器验证已完成，预览二维码位于本机 `D:/tab-out/output/record-history-20261101/miniprogram-preview-final.jpg`，未发布。
- 两端历史入口、草稿、差异和恢复操作已有候选；真实手机语音、键盘、安全区、所有主题及实际三端 UI 互通尚待验收。当前个人浏览器的旧安装不会因云端上线自动升级为 1.3.3。
- 本次已恢复确认的一条日期错误记录并保留日课，不能宣称找回当天所有可能丢失内容。上传前日期为何写为前一天仍未重现；现有证据不支持把原始两次同步认定为整日删除。

代码、候选验证、线上服务、个人终端安装及正式发布分别记录，不混用完成状态。

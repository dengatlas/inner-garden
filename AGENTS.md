# AGENTS.md — Independent Inner Garden extension

## Scope and communication

- Explain outcomes in Simplified Chinese; keep technical identifiers in English.
- Maintain only this independent desktop Chrome Manifest V3 new-tab workspace: tabs, focus, calendar, weekly plans, daily logs and flomo.
- Do not edit the original Tab Out project or import its PWA, Mini Program, backend, personal exports or Git history.
- Explicit 2026-10-01 exception: the user authorized only D:/tab-out/miniprogram/features/account/index.wxml, features/account/index.js and utils/sync-service.js for current-phone-account device authorization. Do not edit other original files or run its generating build. Keep that change out of this independent repository.
- Keep Agent_cn.md synchronized with these rules.

## Current authority

- docs/DECISIONS.md and docs/decisions/public-edition.json record the user's accepted 1B/2A/3A/4A/5A choices and subsequent public-repository authorization: existing CloudBase for service-eligible accounts, new fixed ID, local fonts/icons, reviewed prompt content and independent Git.
- docs/ACCEPTANCE.md records current evidence and open acceptance. Do not conflate automated checks, browser acceptance, cloud-account acceptance and publication.
- MIGRATION_HANDOFF.md, PUBLIC_RELEASE_PLAN.md and COPY_BASELINE.json are historical ignored handoff material, not current product policy. Never overwrite the baseline to conceal intentional development differences.
- The new ID is ohdenlpjdfngpaaggijhcagfpafecgdn. Keep it stable. The user authorized appending this account origin on 2026-09-30; the change and preflight were verified. Current acceptance is recorded in docs/ACCEPTANCE.md, including user-confirmed desktop login and partial synchronization; do not claim all accounts are usable from origin authorization alone.

## Implementation boundaries

- Preserve offline editing, existing storage keys, schema-v3, unsaved drafts, account isolation, local backups and Asia/Shanghai display time.
- workspace-background.js owns serialized workspace/account writes and multi-page coordination. Pages must not bypass it. Device imports must also be coordinated by the worker.
- Tabs, saved-for-later and focus remain device-local. Workspace sync includes calendar events, weekly plans and daily-log fields. flomo is separate and optional; images, drafts and preferences remain local.
- Same-service migration must exclude auth sessions and reset device IDs; never merge different accounts implicitly. Import only into a pristine installation.
- Do not change remote services, origin rules or account policy without current authorization. Preserve existing origins and use an exact origin if such a change is authorized.
- Local config, credentials, sessions, private exports and browser profiles must never enter Git or release packages. Connection URLs and manifest key are public identifiers, not private signing keys.

## Development and verification

- Canonical shared code is root shared/. Run npm run build to regenerate extension/shared/. The build only targets this extension; never run the original multi-client build.
- Node 22+ is for maintainers; users load the shipped extension without building. Do not add a framework, backend or dependencies just for installation.
- For code changes run npm run build, npm run check, npm test, then git diff --check. UI changes additionally require real Chrome extension verification from an extracted ZIP in an isolated profile.
- Run only relevant checks; do not write redundant tests for small reversible documentation changes. Remove task-only temporary files and browser profiles when no longer needed.
- Font source hashes and licenses are in docs/font-assets.json and extension/fonts/. Review prompt evidence in docs/prompt-review.json; don't infer third-party permission from the app's MIT license.

## Distribution and Git

- Project root is confirmed as this directory. Use codex/ working branches. The 1.3.2 release preparation branch is codex/release-1.3.2; the earlier independent branch is codex/public-edition; origin is https://github.com/dengatlas/inner-garden.git. No original project history or remote is inherited; initialize no other project.
- npm run package uses scripts/extension-files.mjs as an explicit allowlist. Include LICENSE, font and icon notices, installation/privacy instructions; exclude config.local.js and private data.
- ZIP installation: extract, Chrome Developer mode, Load unpacked, select manifest directory. Do not promise arbitrary CRX drag-and-drop or GitHub automatic updates.
- Keep version in manifest, package.json, policy and changelog consistent. Rebuild/retest a package after its final content changes.
- The user authorized creating the public dengatlas/inner-garden repository and pushing this independent project on 2026-09-30. Releases, store submission and remote-service changes still require separate authorization.

## 2026-10-06 flomo coordination authority

The user authorized coordinated changes in this independent extension and D:/tab-out for flomo sync from the current chat. This supersedes the earlier three-file-only exception for this task; the repositories and commits remain separate, and no remote deployment/publication is included.

The canonical cross-client flomo modules are the three explicit files shared/flomo.js, shared/flomo-sync.js and shared/flomo-transport.js in D:/tab-out. Its scripts/sync-flomo-contract.mjs updates only those files in this repository and records docs/flomo-contract.json; npm run build still generates extension/shared/ locally. npm run check validates their pinned content hashes. Do not copy auth clients or prompt seeds between repositories.

Explicitly enabled account libraries follow the signed-in account and join the unified manual/12-minute foreground sync trigger. The worker persists attempt throttling and each library's pending state; one engine's failure never blocks the other. Viewing the original local library remains local; account changes never copy the previous account into the new one. Drafts/images/preferences remain local. Received-note counts and pending/conflict status must remain visible, including edits made during synchronization. No backend schema change is required.

## 2026-10-14 flomo repair

flomo enabled state is independent of the viewed library. Desktop original local records are read-only archive previews; viewing them must not pause account sync or reimport them implicitly. First enable performs an immediate exchange after a single account/count preview. Conflicts are per note/tag with stale-preview guards; unresolved items do not block independent notes. Preserve immutable pending requests and local-only images/drafts.

Temporary refresh failures preserve sessions; explicit invalid grants require reauthentication while retaining the cached account library. Backups are account-scoped, retain 30 automatic entries plus manual/legacy entries, and restore by reviewed merge. Generate Mini Program copies only with D:/tab-out/scripts/build-shared.mjs --target=miniprogram; do not regenerate the legacy desktop, PWA or backend for this repair. No backend deployment is required.


## 2026-10-24 account focus records

The user authorized coordinated implementation in D:/tab-out (Mini Program, shared workspace/focus contracts and existing backend) and E:/Traecode/Inner garden (formal extension), with separate commits. Completed focus sessions now have optional account sync through the existing workspace queue, entity type focus_session, capability-gated pulls and an independent focusCursor; previous device-only focus-history statements are superseded by this section. Running timers remain local. Manual/12-minute foreground scheduling is unchanged.

Fix ownership at session start. Account caches and statistics are isolated; legacy/guest history needs an explicit count/date preview and one-time claim journal with an original backup. Only completed focus/custom/countup records count, overlap across devices sums separately, identical IDs deduplicate, dates use Shanghai completion day. The first edition adds no record edit/delete UI. Desktop completions are serialized in the worker. Day/week/month records are accessible beside the existing timer; optional notes have the same 80-character limit as mobile.

Focus history sync and calendar projection have separate opt-ins. Project only local-source sessions for the corresponding account; do not project downloaded records again or recreate deleted calendar blocks. Calendar deletion never deletes original focus history or statistics. Sync off retains caches/queues. Main-package focus-account-store.js owns Mini Program cache/claim metadata; the extension uses innerGardenFocusAccounts. See docs/FOCUS_SYNC.md for storage, migration, tests and rollout.

Canonical focus-records.js and workspace-sync.js live in D:/tab-out/shared and are copied by scripts/sync-focus-contract.mjs with pinned hashes. Port only the reviewed focus changes to sync-client.js; retain each project's authentication differences. Backend deployment adds private focus_sessions and the owner/type/revision change index before clients. Do not deploy the legacy extension, PWA or flomo backend for this feature.

User restriction: legal-domain configuration has limited saves. Any modification/save of WeChat legal domains requires explicit consent for that individual save. Preserve existing domains, gateway routes, origins and authentication settings during this rollout. Code, test, package, cloud-deploy and real-device evidence are separate states.


## 2026-10-24 flomo account-cache workflow

The current flomo workflow supersedes older editable local/account library switching. After first enable, signed-in users view and edit their current account's device cache; pausing sync keeps that cache editable. Original local records remain a read-only archive and are never copied again merely by viewing, reopening, or switching accounts. First enable exchanges immediately with no empty confirmation when there are no original notes; otherwise show one account/count merge preview. Keep images and drafts local and preserve immutable pending requests, per-item conflicts and account isolation.

Persist flomo sync choice per account and device. An explicit false overrides legacy inference from an existing account cache; reload, restart and cache reads must not re-enable it. Retain manual and 12-minute foreground scheduling. Show workspace (calendar/daily/week plans), focus and flomo results separately even though focus uses the workspace protocol. A failure in one category must not relabel or conceal another result.

Keep page/worker flomo messages compatible. Missing owner fields must not create an undefined library. Preserve anomalous historical libraries for inspection; do not silently delete, merge into the active account, or upload them. Device migration retains flomo content/caches/pending data but resets its sync choices on the target device. Existing focus-history, claim-journal, source-device and opt-in migration rules remain unchanged.

This client-only candidate requires no backend deployment, origin/gateway changes or legal-domain saves. Keep the already-deployed focus backend and its acceptance record intact. The formal extension candidate is 1.3.1; record new build, package/browser, Mini Program preview and same-UID real-account acceptance separately. See docs/FLOMO_SYNC.md in the independent extension and docs/FLOMO_DEPLOYMENT.md in D:/tab-out.


## 2026-10-25 device authorization proxy

The existing tab-out-sync authentication proxy now supports device-code issuance and exchange. The deployment preserves all current origins, routes, configuration and previously deployed workspace/focus/agent code. Device-code issuance and pending responses were verified live; phone confirmation, same-UID login and bidirectional synchronization remain separate acceptance steps. See docs/DEVICE_AUTH_SERVICE_CHANGE.md and docs/WECHAT_DESKTOP_LOGIN.md for current evidence. Mini Program account-page and binding feedback changes remain in D:/tab-out; do not copy its authentication client wholesale into this independent extension.


## 1.3.2 device-flow compatibility

Device authorization codes are opaque strings (1-256 visible non-space characters), preserved without case or whitespace normalization. QR v1 may include the exact server-issued scope. A successful device grant may omit refresh_token; accept a valid access token and expiry after exact UID verification, keep credentials in the worker, cap access-only trust at the absolute access expiry, and show that deadline. Never claim ten-day persistence for such grants. Version, manifest, package policy and changelog are 1.3.2. The packaged ZIP passed isolated Chrome UI checks; real same-UID service exchange passed with the temporary test session revoked. Installed-client UI and bidirectional data acceptance remain separate.

## 2026-10-26 release preparation and user acceptance

The user confirmed successful login in their actual installed desktop client and partial data synchronization. Record this as user-reported real-terminal acceptance. Data categories, directions and create/edit/delete coverage were not specified; do not infer full workspace/focus/flomo bidirectional acceptance. This section supersedes generic pending-login statements for this user-confirmed scope.

Prepare version 1.3.2 as a formal release on codex/release-1.3.2. Keep source, package and acceptance evidence aligned. Preserve necessary development paths and public connection identifiers. After reviewing the final artifacts and release notes, the user explicitly authorized committing this reviewed batch, pushing and integrating it into main, tagging v1.3.2 and creating the formal public GitHub Release with only the installation ZIP and its checksum attached. This authorization applies to this 1.3.2 release. No store submission or remote-service changes are included.

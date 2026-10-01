# AGENTS.md — Independent Inner Garden extension

## Scope and communication

- Explain outcomes in Simplified Chinese; keep technical identifiers in English.
- Maintain only this independent desktop Chrome Manifest V3 new-tab workspace: tabs, focus, calendar, weekly plans, daily logs and flomo.
- Do not edit the original Tab Out project or import its PWA, Mini Program, backend, personal exports or Git history.
- Keep Agent_cn.md synchronized with these rules.

## Current authority

- docs/DECISIONS.md and docs/decisions/public-edition.json record the user's accepted 1B/2A/3A/4A/5A choices and subsequent public-repository authorization: existing CloudBase for service-eligible accounts, new fixed ID, local fonts/icons, reviewed prompt content and independent Git.
- docs/ACCEPTANCE.md records current evidence and open acceptance. Do not conflate automated checks, browser acceptance, cloud-account acceptance and publication.
- MIGRATION_HANDOFF.md, PUBLIC_RELEASE_PLAN.md and COPY_BASELINE.json are historical ignored handoff material, not current product policy. Never overwrite the baseline to conceal intentional development differences.
- The new ID is ohdenlpjdfngpaaggijhcagfpafecgdn. Keep it stable. Existing service rejects the new account origin until authorized; do not claim all accounts are usable from configuration alone.

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

- Project root is confirmed as this directory. Use codex/ working branches. Current branch is codex/public-edition; origin is https://github.com/dengatlas/inner-garden.git. No original project history or remote is inherited; initialize no other project.
- npm run package uses scripts/extension-files.mjs as an explicit allowlist. Include LICENSE, font and icon notices, installation/privacy instructions; exclude config.local.js and private data.
- ZIP installation: extract, Chrome Developer mode, Load unpacked, select manifest directory. Do not promise arbitrary CRX drag-and-drop or GitHub automatic updates.
- Keep version in manifest, package.json, policy and changelog consistent. Rebuild/retest a package after its final content changes.
- The user authorized creating the public dengatlas/inner-garden repository and pushing this independent project on 2026-09-30. Releases, store submission and remote-service changes still require separate authorization.

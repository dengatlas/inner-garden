# Changelog

## 1.2.1 — Phone authorization candidate

- Let the current Mini Program account authorize a separate desktop session through CloudBase OAuth device flow; keep credentials in the extension worker.
- Generate QR codes locally, require explicit UID confirmation, and discard canceled, expired or superseded challenges.
- Show account UID and distinguish account login from workspace/flomo synchronization; allow valid current-password changes without an unrelated recovery requirement.
- Record the separately authorized three-file Mini Program change and the reviewed, not-yet-deployed account proxy patch. Real phone authorization and two-device sync remain pending.

## 1.2.0 — Local public-edition candidate

- Independent fixed extension ID for coexistence with the old installation.
- Retain the existing CloudBase environment for its service-eligible accounts; new-origin authorization and real-account acceptance remain pending.
- Bundle DM Sans and Newsreader with OFL licenses; generate website icons locally.
- Exclude unverified built-in prompt material without removing existing notes.
- Establish canonical shared sources, extension-only build/check/tests and explicit-allowlist ZIP packaging.
- Preserve local editing, schema-v3, storage keys, drafts, account isolation and Shanghai display time.
- Provide installation, privacy, development and migration instructions. No upload or publication performed.

/* Maintainer-only local overrides. Ordinary devices do not need this file.
 * Set TAB_OUT_LOAD_LOCAL_CONFIG=true in config.js only in your private checkout.
 * Return it to false before checks or packaging. */
globalThis.TAB_OUT_SYNC_CONFIG = {
  enabled: true,
  environmentId: 'your-cloudbase-environment-id',
  storageNamespace: '', // Set to the target environment ID for an intentional migration.
  defaultUsername: '',
  authBaseUrl: 'https://your-env-id.ap-shanghai.app.tcloudbase.com/auth-proxy/v1',
  apiBaseUrl: 'https://your-env-id.ap-shanghai.app.tcloudbase.com/sync/v1',
  flomoApiBaseUrl: 'https://your-env-id.ap-shanghai.app.tcloudbase.com/flomo/v1',
  pollIntervalMs: 720000, // Finalized to the product-wide 12-minute interval.
};

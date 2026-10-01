/* Public connection settings shared by every installation.
 * These values identify the CloudBase endpoints; they are not credentials. */
// Maintainers may explicitly opt in to a private config.local.js while developing.
// Public source and installation ZIPs must keep this false.
globalThis.TAB_OUT_LOAD_LOCAL_CONFIG = false;
globalThis.TAB_OUT_SYNC_CONFIG_DEFAULT = Object.freeze({
  enabled: true,
  environmentId: 'dk-checkin-d8gw6jhrt5b2ced62',
  storageNamespace: 'dk-checkin-d8gw6jhrt5b2ced62',
  defaultUsername: '',
  authBaseUrl: 'https://dk-checkin-d8gw6jhrt5b2ced62-1467421685.ap-shanghai.app.tcloudbase.com/auth-proxy/v1',
  apiBaseUrl: 'https://dk-checkin-d8gw6jhrt5b2ced62-1467421685.ap-shanghai.app.tcloudbase.com/sync/v1',
  flomoApiBaseUrl: 'https://dk-checkin-d8gw6jhrt5b2ced62-1467421685.ap-shanghai.app.tcloudbase.com/flomo/v1',
  pollIntervalMs: 720000,
});
globalThis.TAB_OUT_SYNC_CONFIG = { ...globalThis.TAB_OUT_SYNC_CONFIG_DEFAULT };

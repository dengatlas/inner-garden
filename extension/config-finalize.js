/* A gitignored config.local.js may override public endpoints or local UI values.
 * The product-wide automatic sync interval is deliberately not configurable. */
globalThis.TAB_OUT_SYNC_CONFIG = Object.freeze({
  ...globalThis.TAB_OUT_SYNC_CONFIG_DEFAULT,
  ...(globalThis.TAB_OUT_SYNC_CONFIG || {}),
  pollIntervalMs: 720000,
});

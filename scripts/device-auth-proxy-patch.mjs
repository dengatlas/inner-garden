/* Apply only the two device-flow changes to a reviewed deployed auth proxy.
 * This script neither deploys code nor changes environment/origin settings. */
export function patchDeviceAuthProxy(source) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const edits = [
    ["    '/auth/v1/token': route('POST', '/auth/v1/token', ['grant_type', 'refresh_token', 'client_id'], {\n      required: ['grant_type', 'refresh_token', 'client_id'],\n    }),",
      "    '/auth/v1/device/code': route('POST', '/auth/v1/device/code', ['client_id'], {\n      required: ['client_id'],\n    }),\n    '/auth/v1/token': route('POST', '/auth/v1/token', ['grant_type', 'refresh_token', 'device_code', 'client_id'], {\n      required: ['grant_type', 'client_id'],\n    }),"],
    ['    grant_type: 32,', '    grant_type: 64,\n    device_code: 4096,'],
    ["    if (route.path === '/auth/v1/signin') {", "    if (route.path === '/auth/v1/signin' || route.path === '/auth/v1/device/code') {"],
    ["  if (route.path === '/auth/v1/token' && body.grant_type !== 'refresh_token') {\n    return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid grant_type.' } };\n  }",
      "  if (route.path === '/auth/v1/token') {\n    const refresh = body.grant_type === 'refresh_token' && Boolean(body.refresh_token) && !body.device_code;\n    const device = body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code' && Boolean(body.device_code) && !body.refresh_token;\n    if (!refresh && !device) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Choose one valid token grant.' } };\n  }"],
  ];
  let next = source;
  for (const [from, to] of edits) {
    // The deployed file contains mixed EOLs. Match either without normalizing
    // unrelated lines or silently applying a patch to a different revision.
    const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n'), 'g');
    const matches = [...next.matchAll(pattern)];
    if (matches.length !== 1) throw new Error('Deployed proxy differs from reviewed patch; stop and review it.');
    next = next.replace(pattern, () => to.replace(/\n/g, eol));
  }
  return next;
}

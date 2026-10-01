/* Public seed: copied prompts lack supplied redistribution evidence.
 * Review metadata: docs/prompt-review.json. Existing notes remain untouched. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InnerGardenPromptSeed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const entries = Object.freeze([]);
  function apply(state) {
    if (state.promptSeedVersion === 2) return false;
    state.promptSeedVersion = 2;
    return true;
  }
  return { entries, apply };
});

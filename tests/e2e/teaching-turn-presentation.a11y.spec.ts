import { test } from '../helpers/electron'

/**
 * P0-R5 deliberately has no App.tsx or IPC ownership, so no canonical teaching
 * snapshot can be mounted in Electron yet. P0-R6 owns that narrow integration
 * seam. The unit contract exercises the real reader with keyboard/focus and
 * the browser E2E test becomes executable once P0-R6 supplies the fixture.
 */
test.skip('teaching turn learner flow is accessible in Electron after typed snapshot integration @a11y', async () => {
  // Intentionally held for P0-R6: do not fabricate a DOM fixture that bypasses
  // the actual renderer adapter or mutate the App/store outside this package.
})
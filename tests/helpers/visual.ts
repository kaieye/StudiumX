import type { Page } from '@playwright/test'

export async function stabilizeForVisualSnapshot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `
  })
  await page.evaluate(async () => {
    await document.fonts?.ready
  })
}

import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

type AccessibilityScanOptions = {
  include?: string
  exclude?: string[]
  tags?: string[]
  disableRules?: string[]
}

export async function expectNoAccessibilityViolations(
  page: Page,
  options: AccessibilityScanOptions = {}
): Promise<void> {
  let builder = new AxeBuilder({ page }).setLegacyMode(true)

  if (options.include) builder = builder.include(options.include)
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector)
  if (options.tags?.length) builder = builder.withTags(options.tags)
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules)

  const results = await builder.analyze()
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target)
  }))

  expect(summary, `Accessibility violations:\n${JSON.stringify(summary, null, 2)}`).toEqual([])
}


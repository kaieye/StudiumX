import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { createIsolatedTestRuntime, isPathInside } from '../helpers/runtime-isolation'
import { renderUi, setupUser } from '../helpers/render'

function AnalyticsFoundationProbe() {
  const [count, setCount] = useState(0)
  return (
    <section aria-labelledby="analytics-foundation-heading">
      <h1 id="analytics-foundation-heading">Analytics test foundation</h1>
      <output aria-live="polite">Events: {count}</output>
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        Record event
      </button>
    </section>
  )
}

describe('analytics test foundation', () => {
  it('renders React in jsdom and supports user interaction matchers', async () => {
    const user = setupUser()
    renderUi(<AnalyticsFoundationProbe />)

    expect(screen.getByRole('heading', { name: 'Analytics test foundation' })).toBeVisible()
    expect(screen.getByText('Events: 0')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Record event' }))

    expect(screen.getByText('Events: 1')).toBeVisible()
  })

  it('creates user-data and workspace paths only inside a disposable runtime', async () => {
    const runtime = await createIsolatedTestRuntime('vitest-smoke')
    try {
      expect(isPathInside(runtime.rootDir, runtime.userDataDir)).toBe(true)
      expect(isPathInside(runtime.rootDir, runtime.workspaceDir)).toBe(true)
      expect(runtime.userDataDir).not.toContain('.studiumx')
    } finally {
      await runtime.cleanup()
    }
  })
})

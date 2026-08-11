import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AuthScreenLayout } from '@renderer/ui/AuthScreenLayout'
import { renderUi } from '../helpers/render'

describe('authentication screen window movement', () => {
  it('uses a translucent, blurred surface when presented over a page', () => {
    const { container } = renderUi(
      <AuthScreenLayout
        ariaLabel="Sign in"
        overlay
        title="Welcome"
        stage={<div>challenge</div>}
        actions={<button type="button">Sign in</button>}
        footer={<>Terms</>}
      />
    )

    expect(container.querySelector('.auth-screen')).toHaveClass('auth-screen--overlay')

    const authStyles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/auth.css'), 'utf8')
    expect(authStyles).toMatch(
      /\.auth-screen--overlay\s*\{[\s\S]*backdrop-filter:\s*blur\(4px\);[\s\S]*-webkit-backdrop-filter:\s*blur\(4px\);/
    )
  })

  it('provides a dedicated draggable strip above the login controls', () => {
    const { container } = renderUi(
      <AuthScreenLayout
        ariaLabel="Sign in"
        title="Welcome"
        stage={<div>challenge</div>}
        actions={<button type="button">Sign in</button>}
        footer={<>Terms</>}
      />
    )

    const dragRegion = container.querySelector('.auth-screen-drag-region')
    expect(dragRegion).toBeInTheDocument()
    expect(dragRegion).toHaveAttribute('aria-hidden', 'true')

    const authStyles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/auth.css'), 'utf8')
    expect(authStyles).toMatch(
      /\.auth-screen-drag-region\s*\{[\s\S]*app-region:\s*drag;[\s\S]*-webkit-app-region:\s*drag;/
    )
    expect(authStyles).toMatch(
      /\.auth-screen-card\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*2;/
    )
  })
})

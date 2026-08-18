import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import {
  MindMapExportFeedback,
  type MindMapExportFeedbackState
} from '../../src/renderer/src/views/mindmap/MindMapExportFeedback'

function renderFeedback(state: MindMapExportFeedbackState, onDismiss = vi.fn()) {
  render(<MindMapExportFeedback state={state} onDismiss={onDismiss} />)
  return onDismiss
}

describe('MindMapExportFeedback', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('announces the format while an export is flushing and hides dismissal until it settles', () => {
    renderFeedback({ status: 'exporting', format: 'markdown' })

    expect(screen.getByRole('status')).toHaveTextContent('Exporting Markdown…')
    expect(screen.queryByRole('button', { name: 'Dismiss message' })).not.toBeInTheDocument()
  })

  it('reports a completed path and supports dismissing the result', async () => {
    const user = userEvent.setup()
    const onDismiss = renderFeedback({
      status: 'success',
      format: 'svg',
      path: '/tmp/course.svg'
    })

    expect(screen.getByRole('status')).toHaveTextContent('SVG exported to /tmp/course.svg')
    await user.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('uses an assertive alert for failures and preserves the safe error reason', () => {
    renderFeedback({
      status: 'error',
      format: 'markdown',
      message: 'Mind map is still saving; try again when the save completes.'
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Markdown export failed: Mind map is still saving; try again when the save completes.'
    )
  })

  it('distinguishes a cancelled native folder picker from an export failure', () => {
    renderFeedback({ status: 'cancelled', format: 'opml' })

    expect(screen.getByRole('status')).toHaveTextContent('OPML export cancelled.')
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapImportCompatibilityReport } from '../../src/renderer/src/views/mindmap/MindMapImportCompatibilityReport'
import type { XmindCompatibilityReport } from '../../src/shared/mindmap/xmind-compatibility'

function makeReport(overrides: Partial<XmindCompatibilityReport> = {}): XmindCompatibilityReport {
  return {
    preserved: [
      {
        path: 'sheets',
        count: 2,
        reason: 'Sheet collection maps to StudiumX sheets'
      },
      {
        path: 'topics[].title',
        count: 3,
        reason: 'Topic title retained'
      }
    ],
    approximated: [
      {
        path: 'sheets[].structureClass',
        count: 1,
        reason: 'Missing structure class defaults to the right layout'
      }
    ],
    dropped: [],
    warnings: [],
    ...overrides
  }
}

describe('MindMapImportCompatibilityReport', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('summarizes all four categories using occurrence counts', () => {
    render(
      <MindMapImportCompatibilityReport
        report={makeReport({
          dropped: [
            {
              path: 'topics[].style',
              count: 4,
              reason: 'Field is not representable by the StudiumX mind-map model'
            }
          ],
          warnings: [
            {
              path: 'topics[].style',
              count: 2,
              reason: 'Unsupported XMind element metadata was not migrated into StudiumX elements'
            }
          ]
        })}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This XMind import includes approximations or unsupported content.'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Preserved: 5')
    expect(screen.getByRole('alert')).toHaveTextContent('Approximated: 1')
    expect(screen.getByRole('alert')).toHaveTextContent('Dropped: 4')
    expect(screen.getByRole('alert')).toHaveTextContent('Warnings: 2')
  })

  it('uses a polite status when no dropped content or warnings were reported', () => {
    render(
      <MindMapImportCompatibilityReport
        report={makeReport()}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Some XMind fields were approximated during import; no content was dropped.'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('expands findings with localized reasons and supports dismissal', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(
      <MindMapImportCompatibilityReport
        report={makeReport({
          approximated: [
            {
              path: 'sheets[].title',
              count: 2,
              reason: 'Missing title becomes an empty string'
            }
          ]
        })}
        onDismiss={onDismiss}
      />
    )

    const categorySummary = screen
      .getAllByText('Approximated: 2')
      .find((element) => element.closest('details'))
    const category = categorySummary?.closest('details') ?? null
    expect(category).not.toBeNull()
    expect(category).not.toHaveAttribute('open')

    await user.click(categorySummary!)
    expect(category).toHaveAttribute('open')
    expect(screen.getByText('sheets[].title')).toBeVisible()
    expect(screen.getByText('A missing title becomes an empty string.')).toBeVisible()
    expect(
      screen
        .getAllByText('2 occurrences')
        .find((element) => element.closest('details')?.open)
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Dismiss compatibility report' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('keeps an unknown reason inside a localized fallback', () => {
    render(
      <MindMapImportCompatibilityReport
        report={makeReport({
          preserved: [],
          approximated: [
            {
              path: 'sheets[].futureField',
              count: 1,
              reason: 'A future importer detail'
            }
          ]
        })}
        onDismiss={vi.fn()}
      />
    )

    const categorySummary = screen
      .getAllByText('Approximated: 1')
      .find((element) => element.closest('details'))
    fireEvent.click(categorySummary!)
    expect(screen.getByText('Import detail: A future importer detail')).toBeVisible()
  })

  it('localizes category labels and dismissal in Chinese', async () => {
    await i18n.changeLanguage('zh-CN')
    render(
      <MindMapImportCompatibilityReport
        report={makeReport({
          dropped: [
            {
              path: 'topics[].style',
              count: 1,
              reason: 'Field is not representable by the StudiumX mind-map model'
            }
          ]
        })}
        onDismiss={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('已忽略：1')
    expect(screen.getByRole('button', { name: '关闭兼容性报告' })).toBeInTheDocument()
  })
})

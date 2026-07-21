import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeachingDoctorSettingsSection } from '../../src/renderer/src/views/settings/sections/TeachingDoctorSettingsSection'
import type { TeachingDoctorReport, TeachingSystemApi } from '../../src/shared/teaching-types'
import '../../src/renderer/src/i18n'

const originalTeachingSystem = window.teachingSystem

function installTeachingSystem(api: Partial<TeachingSystemApi> | undefined): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: api as TeachingSystemApi
  })
}

const sampleReport: TeachingDoctorReport = {
  schemaVersion: 1,
  generatedAt: '2026-07-21T12:00:00.000Z',
  overallStatus: 'warning',
  workspaceOpenPolicy: 'read_only_allowed',
  mode: 'read_only',
  checks: [
    {
      checkId: 'local_process_crash_marker',
      result: 'warning',
      summary: 'Prior process crash marker present',
      evidence: { fields: { present: true }, notes: [] },
      recommendedAction: 'Review recent abnormal exit; marker is not cleared by doctor.',
      repair: { kind: 'manual_review', description: 'Manual review only', autoRepairAllowed: false },
      fixSuggestion: {
        code: 'review_crash_marker',
        title: 'Inspect crash marker manually',
        steps: ['Open app data observability folder', 'Confirm last abnormal exit reason']
      }
    }
  ],
  diagnostics: {
    redaction: 'export_safe',
    autoRepair: 'disabled'
  }
}

beforeEach(() => {
  installTeachingSystem(undefined)
})

afterEach(() => {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: originalTeachingSystem
  })
})

describe('TeachingDoctorSettingsSection', () => {
  it('runs doctor via product IPC and renders overall status plus check summary', async () => {
    const user = userEvent.setup()
    const runTeachingDoctor = vi.fn(async () => sampleReport)
    installTeachingSystem({ runTeachingDoctor })

    render(<TeachingDoctorSettingsSection />)

    expect(screen.getByTestId('doctor-empty')).toBeInTheDocument()
    expect(runTeachingDoctor).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('doctor-run'))

    await waitFor(() => {
      expect(screen.getByText('Prior process crash marker present')).toBeInTheDocument()
    })
    expect(runTeachingDoctor).toHaveBeenCalledTimes(1)
    expect(runTeachingDoctor).toHaveBeenCalledWith({ includeProcessCrashMarker: true })
    expect(screen.getByTestId('doctor-overall-status')).toHaveAttribute('data-state', 'warning')
    expect(screen.getByTestId('doctor-check')).toHaveAttribute('data-check-id', 'local_process_crash_marker')
    expect(screen.getByText(/Inspect crash marker manually/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /repair|修复|auto/i })).not.toBeInTheDocument()
  })

  it('shows a non-secret error message when doctor rejects', async () => {
    const user = userEvent.setup()
    const runTeachingDoctor = vi.fn(async () => {
      throw new Error('doctor channel unavailable')
    })
    installTeachingSystem({ runTeachingDoctor })

    render(<TeachingDoctorSettingsSection />)
    await user.click(screen.getByTestId('doctor-run'))

    const alert = await screen.findByTestId('doctor-error')
    expect(alert).toHaveTextContent('doctor channel unavailable')
    expect(alert.textContent).not.toMatch(/[A-Za-z]:\\/)
  })
})

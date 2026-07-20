import { describe, expect, it } from 'vitest'
import { validateVitestResult } from '../../scripts/learning-outcome-runtime-gate.mjs'

const report = (status = 'passed') => JSON.stringify({ success: status === 'passed', testResults: [{ assertionResults: [{ status }] }] })

describe('learning outcome runtime gate helper', () => {
  it('accepts exactly one passing required scenario', () => {
    expect(() => validateVitestResult(report(), { scenario: 'required' })).not.toThrow()
  })
  it('fails when required scenario matched no passing test', () => {
    expect(() => validateVitestResult(report('skipped'), { scenario: 'required' })).toThrow()
  })
})

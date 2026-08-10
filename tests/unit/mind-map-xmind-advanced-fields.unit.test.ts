import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildXmindImportCompatibilityReport } from '../../src/shared/mindmap/xmind-compatibility'

const FIXTURES_DIR = resolve(process.cwd(), 'docs/mindmap/benchmarks/fixtures')

function readFixture(file: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, file), 'utf8'))
}

describe('XMind advanced-field compatibility gates', () => {
  it('reports every currently unsupported M6 fixture field instead of silently dropping it', () => {
    const fixtureExpectations = [
      {
        file: 'xmind-content-styles.json',
        droppedPaths: ['sheets[].theme', 'topics[].style']
      },
      {
        file: 'xmind-content-summaries.json',
        droppedPaths: ['sheets[].summaries']
      },
      {
        file: 'xmind-content-attachments.json',
        droppedPaths: ['topics[].image', 'topics[].attachment']
      },
      {
        file: 'xmind-content-unsupported-fields.json',
        droppedPaths: [
          'topics[].markers',
          'topics[].labels',
          'topics[].href',
          'topics[].task',
          'topics[].image',
          'topics[].attachment',
          'sheets[].summaries'
        ]
      }
    ] as const

    for (const fixture of fixtureExpectations) {
      const report = buildXmindImportCompatibilityReport(readFixture(fixture.file))
      const droppedPaths = new Set(report.dropped.map((finding) => finding.path))

      for (const path of fixture.droppedPaths) {
        expect(droppedPaths, `${fixture.file} should report ${path}`).toContain(path)
      }
    }
  })

  it('keeps attachment findings warning-bearing and value-free', () => {
    const report = buildXmindImportCompatibilityReport(
      readFixture('xmind-content-attachments.json')
    )
    const attachmentWarnings = report.warnings.filter(
      (finding) => finding.reason === 'Attachment or image was not migrated into workspace assets'
    )

    expect(attachmentWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'topics[].image', count: 1 }),
        expect.objectContaining({ path: 'topics[].attachment', count: 1 })
      ])
    )
    expect(JSON.stringify(report)).not.toContain('attachments/diagram.png')
    expect(JSON.stringify(report)).not.toContain('attachments/lesson.pdf')
  })
})

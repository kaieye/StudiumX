import { describe, expect, it } from 'vitest'

import {
  buildMindMapSourceJumpTarget,
  resolveMindMapSourceJumpTarget
} from '../../src/shared/mindmap/domain/source-jump'
import type { MindMapSourceRef } from '../../src/shared/mindmap/domain/types'

describe('buildMindMapSourceJumpTarget', () => {
  it('normalizes a Windows lesson locator and builds a lesson reader payload', () => {
    expect(
      buildMindMapSourceJumpTarget(
        {
          id: 'lesson-source',
          workspacePath: '.\\lessons\\Unit 1\\intro.md',
          blockId: 'intro-block'
        },
        'workspace-1'
      )
    ).toEqual({
      kind: 'lesson',
      locator: 'lessons/Unit 1/intro.md',
      readerPayload: {
        workspaceId: 'workspace-1',
        lessonPath: 'lessons/Unit 1/intro.md'
      },
      blockId: 'intro-block',
      canResolve: true
    })
  })

  it('uses the markdown reader payload for notes sources', () => {
    expect(
      buildMindMapSourceJumpTarget(
        { id: 'notes-source', workspacePath: 'notes/chemistry.md' },
        'workspace-1'
      )
    ).toEqual({
      kind: 'notes',
      locator: 'notes/chemistry.md',
      readerPayload: {
        workspaceId: 'workspace-1',
        documentPath: 'notes/chemistry.md'
      },
      canResolve: true
    })
  })

  it('uses the existing markdown reader payload for glossary sources', () => {
    expect(
      buildMindMapSourceJumpTarget(
        { id: 'glossary-source', workspacePath: 'GLOSSARY.md', blockId: 'term-block' },
        'workspace-1'
      )
    ).toEqual({
      kind: 'glossary',
      locator: 'GLOSSARY.md',
      readerPayload: {
        workspaceId: 'workspace-1',
        documentPath: 'GLOSSARY.md'
      },
      blockId: 'term-block',
      canResolve: true
    })

    expect(
      buildMindMapSourceJumpTarget(
        { id: 'nested-glossary-source', workspacePath: 'glossary/terms.md' },
        'workspace-1'
      )
    ).toMatchObject({
      kind: 'glossary',
      locator: 'glossary/terms.md',
      readerPayload: {
        workspaceId: 'workspace-1',
        documentPath: 'glossary/terms.md'
      },
      canResolve: true
    })
  })

  it('uses the markdown reader payload for arbitrary workspace locators', () => {
    expect(
      buildMindMapSourceJumpTarget(
        { id: 'workspace-source', workspacePath: 'reading/chemistry.md' },
        'workspace-1'
      )
    ).toMatchObject({
      kind: 'workspace',
      locator: 'reading/chemistry.md',
      readerPayload: {
        workspaceId: 'workspace-1',
        documentPath: 'reading/chemistry.md'
      },
      canResolve: true
    })
    expect(
      buildMindMapSourceJumpTarget(
        { id: 'root-notes-source', workspacePath: 'NOTES.md' },
        'workspace-1'
      ).kind
    ).toBe('notes')
  })

  it('does not build a reader payload when the source path is missing', () => {
    expect(buildMindMapSourceJumpTarget({ id: 'missing-path' }, 'workspace-1')).toEqual({
      kind: 'workspace',
      locator: null,
      readerPayload: null,
      canResolve: false
    })
  })

  it('retains a normalized locator but fails closed without a usable workspace id', () => {
    const ref: MindMapSourceRef = {
      id: 'missing-workspace',
      workspacePath: '.\\notes\\chemistry.md',
      blockId: 'chemistry-block'
    }

    expect(buildMindMapSourceJumpTarget(ref, '   ')).toEqual({
      kind: 'notes',
      locator: 'notes/chemistry.md',
      readerPayload: null,
      blockId: 'chemistry-block',
      canResolve: false
    })
    expect(buildMindMapSourceJumpTarget(ref)).toMatchObject({
      locator: 'notes/chemistry.md',
      readerPayload: null,
      canResolve: false
    })
  })

  it('fails closed for absolute, traversal, and encoded traversal locators', () => {
    for (const workspacePath of [
      '/Users/student/notes.md',
      'C:\\Users\\student\\notes.md',
      '//server/share/notes.md',
      '../outside.md',
      'notes/../../outside.md',
      'notes/%2e%2e/outside.md'
    ]) {
      const target = buildMindMapSourceJumpTarget(
        { id: `unsafe-${workspacePath}`, workspacePath },
        'workspace-1'
      )
      expect(target.locator).toBeTruthy()
      expect(target.readerPayload).toBeNull()
      expect(target.canResolve).toBe(false)
    }
  })

  it('does not mutate the source reference and keeps the resolver alias equivalent', () => {
    const ref: MindMapSourceRef = {
      id: 'stable-source',
      workspacePath: '.\\notes\\chemistry.md',
      breadcrumb: ['Chemistry'],
      blockId: 'block-1'
    }
    const before = structuredClone(ref)

    const built = buildMindMapSourceJumpTarget(ref, 'workspace-1')
    const resolved = resolveMindMapSourceJumpTarget(ref, 'workspace-1')

    expect(built).toEqual(resolved)
    expect(ref).toEqual(before)
  })
})

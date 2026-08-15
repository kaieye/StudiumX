/**
 * Undo/redo stack for the v2 mind map model.
 *
 * The stack stores inverse commands (never snapshots), so undo is just
 * applying the stored inverse and redo is applying the inverse that the
 * reducer returns during undo. Consecutive commands can be merged into a
 * single undo unit by passing a shared `mergeKey`; the merged unit's inverse
 * is a transaction of the newest inverse followed by the previous unit's
 * inverse, so one undo reverts the whole merged group.
 *
 * AI accepts, import/paste and batch styles should be submitted as a single
 * `transaction` command so the group either applies completely or not at all.
 */
import type { MindMapCommand, MindMapCommandResult } from './mind-map-command-types'
import type { MindMapDocumentV2 } from '../domain/types'
import { applyMindMapCommand } from './mind-map-reducer'
import { validateMindMapDocumentV2 } from '../domain/invariants'

export type MindMapUndoEntry = {
  inverse: MindMapCommand
  label: string
  mergeKey?: string
}

export type MindMapExecuteOptions = {
  /** Human-readable label for the undo menu. */
  label?: string
  /**
   * When set and equal to the top undo entry's `mergeKey`, the new command is
   * merged into that entry so undo reverts the whole group at once.
   */
  mergeKey?: string
}

export function defaultMindMapCommandLabel(command: MindMapCommand): string {
  switch (command.type) {
    case 'topic.insert':
      return 'Insert topic'
    case 'topic.update':
      return 'Update topic'
    case 'topic.move':
      return 'Move topic'
    case 'topic.remove':
      return 'Remove topic'
    case 'asset.create':
      return 'Add asset'
    case 'asset.remove':
      return 'Remove asset'
    case 'element.create':
      return 'Create element'
    case 'element.update':
      return 'Update element'
    case 'element.remove':
      return 'Remove element'
    case 'selection.set-style':
      return 'Set style'
    case 'sheet.create':
      return 'Create sheet'
    case 'sheet.rename':
      return 'Rename sheet'
    case 'sheet.update-layout':
      return 'Update sheet layout'
    case 'sheet.reorder':
      return 'Reorder sheet'
    case 'sheet.remove':
      return 'Remove sheet'
    case 'document.apply-theme':
      return 'Apply theme'
    case 'document.rename':
      return 'Rename document'
    case 'transaction':
      return 'Transaction'
  }
}

export class MindMapUndoRedoStack {
  private undoStack: MindMapUndoEntry[] = []
  private redoStack: MindMapUndoEntry[] = []
  private present: MindMapDocumentV2

  constructor(document: MindMapDocumentV2) {
    const validation = validateMindMapDocumentV2(document)
    if (!validation.ok) {
      const detail = validation.errors.map((e) => e.message).join('; ')
      throw new Error(`MindMapUndoRedoStack requires a valid document: ${detail}`)
    }
    this.present = document
  }

  get document(): MindMapDocumentV2 {
    return this.present
  }

  /**
   * Replace the present document with an externally-confirmed equivalent
   * (e.g. the main-process persisted document carrying an incremented
   * revision). Undo/redo history is preserved, only the present snapshot is
   * swapped. Used by the renderer after a successful revisioned save.
   */
  replacePresent(document: MindMapDocumentV2): void {
    const validation = validateMindMapDocumentV2(document)
    if (!validation.ok) {
      const detail = validation.errors.map((e) => e.message).join('; ')
      throw new Error(`MindMapUndoRedoStack.replacePresent requires a valid document: ${detail}`)
    }
    this.present = document
  }

  /**
   * Adopt a document that was already reduced and durably committed by the
   * canonical host lane.  Unlike `execute`, this does not run the command a
   * second time; it records the host-provided inverse so the accepted change
   * remains undoable in the renderer.
   */
  commitExternal(
    document: MindMapDocumentV2,
    inverse: MindMapCommand | null,
    label = 'External update'
  ): void {
    const validation = validateMindMapDocumentV2(document)
    if (!validation.ok) {
      const detail = validation.errors.map((e) => e.message).join('; ')
      throw new Error(`MindMapUndoRedoStack.commitExternal requires a valid document: ${detail}`)
    }
    this.present = document
    this.redoStack = []
    if (inverse !== null) this.undoStack.push({ inverse, label })
  }

  get undoCount(): number {
    return this.undoStack.length
  }

  get redoCount(): number {
    return this.redoStack.length
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  peekUndo(): MindMapUndoEntry | undefined {
    return this.undoStack[this.undoStack.length - 1]
  }

  peekRedo(): MindMapUndoEntry | undefined {
    return this.redoStack[this.redoStack.length - 1]
  }

  execute(command: MindMapCommand, options: MindMapExecuteOptions = {}): MindMapCommandResult {
    const result = applyMindMapCommand(this.present, command)
    if (!result.ok) return result

    this.present = result.document
    this.redoStack = []

    const label = options.label ?? defaultMindMapCommandLabel(command)
    const entry: MindMapUndoEntry = { inverse: result.inverse, label, mergeKey: options.mergeKey }

    const top = this.undoStack[this.undoStack.length - 1]
    if (options.mergeKey !== undefined && top !== undefined && top.mergeKey === options.mergeKey) {
      this.undoStack.pop()
      const mergedInverse: MindMapCommand = {
        type: 'transaction',
        commands: [result.inverse, top.inverse]
      }
      this.undoStack.push({ inverse: mergedInverse, label, mergeKey: options.mergeKey })
    } else {
      this.undoStack.push(entry)
    }

    return result
  }

  undo(): MindMapCommandResult | null {
    const top = this.undoStack.pop()
    if (top === undefined) return null

    const result = applyMindMapCommand(this.present, top.inverse)
    if (!result.ok) {
      this.undoStack.push(top)
      return result
    }

    this.present = result.document
    this.redoStack.push({ inverse: result.inverse, label: top.label, mergeKey: top.mergeKey })
    return result
  }

  redo(): MindMapCommandResult | null {
    const top = this.redoStack.pop()
    if (top === undefined) return null

    const result = applyMindMapCommand(this.present, top.inverse)
    if (!result.ok) {
      this.redoStack.push(top)
      return result
    }

    this.present = result.document
    this.undoStack.push({ inverse: result.inverse, label: top.label, mergeKey: top.mergeKey })
    return result
  }

  /** Reset to a brand-new document, clearing both stacks. */
  reset(document: MindMapDocumentV2): void {
    const validation = validateMindMapDocumentV2(document)
    if (!validation.ok) {
      const detail = validation.errors.map((e) => e.message).join('; ')
      throw new Error(`MindMapUndoRedoStack reset requires a valid document: ${detail}`)
    }
    this.present = document
    this.undoStack = []
    this.redoStack = []
  }
}

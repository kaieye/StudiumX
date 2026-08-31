/**
 * Mind-map IPC command group — interchange (import/export) lanes
 * (ADR-0016 / ADR-0017 portable media interchange).
 *
 * Native import pickers run host-side so file picking works identically on
 * macOS and Windows. Imports are two-phase repository operations that never
 * leave an empty product or durable-write artifacts behind; exports refuse
 * stale or dirty snapshots via the same durable-readiness proof. The gateway
 * registers this group through `createMindMapInterchangeCommands`.
 */
import { BrowserWindow, dialog } from 'electron'
import { join, resolve } from 'node:path'
import { MindMapAssetStore } from './mind-map-assets'
import { importMindMapMarkdownFileWithAssets } from './markdown-import-file'
import { importMindMapOpmlFileWithAssets } from './opml-import-file'
import { exportMindMapOpmlFile } from './opml-file'
import { exportMindMapPortableFile, importMindMapPortableFile } from './portable-file'
import { exportMindMapMarkdownFile } from './markdown-file'
import { exportMindMapSvgFile } from './svg-file'
import { exportMindMapPngFile } from './png-file'
import { MIND_MAP_IMPORT_EXTENSIONS, mindMapImportFormatForFileName } from '../../shared/mindmap/import-format'
import type { MindMapAssetRef, MindMapDocumentV2 } from '../../shared/mindmap/domain/types'
import { assessMindMapExportSnapshotReadiness } from '../../shared/mindmap/export-readiness'
import { getMindMapSvgExportDimensions } from '../../shared/mindmap/svg-export'
import {
  parseMindMapImportDialogPayload,
  parseMindMapMarkdownExportPayload,
  parseMindMapMarkdownImportPayload,
  parseMindMapOpmlExportPayload,
  parseMindMapOpmlImportPayload,
  parseMindMapPngExportPayload,
  parseMindMapPortableExportPayload,
  parseMindMapPortableImportPayload,
  parseMindMapSvgExportPayload
} from '../teaching-ipc-commands'
import { teachingInvokeChannels } from '../../shared/teaching-ipc-contract'
import {
  command,
  type GatewayCommand,
  type GatewayContext,
  identityReply,
  noStreamCleanup
} from '../teaching-ipc-gateway-context'
import {
  createMindMapWorkspaceResolvers,
  unwrapMindMapUpdate
} from './mind-map-ipc-actions-shared'

export function createMindMapInterchangeCommands(context: GatewayContext): GatewayCommand[] {
  const { getMindMapStore, resolveMindMapWorkspaceRoot } =
    createMindMapWorkspaceResolvers(context)

  /** Narrow guard: a strict envelope parser returned null → structured error. */
  const requireMindMapPayload = <Payload>(payload: Payload | null, channel: string): Payload => {
    if (payload === null) throw new Error(`Invalid IPC payload for ${channel}.`)
    return payload
  }

  /**
   * Imports are a two-phase repository operation: create establishes the
   * destination identity, then update publishes the imported document. If the
   * second phase fails (including a CAS conflict), remove the destination so a
   * failed import cannot leave an empty product or durable-write artifacts.
   */
  const persistImportedMindMap = async (
    rootPath: string,
    imported: MindMapDocumentV2,
    fallbackTitle: string,
    channel: string,
    importedAssets: readonly MindMapAssetRef[] = []
  ): Promise<MindMapDocumentV2> => {
    const store = getMindMapStore(rootPath)
    let created: MindMapDocumentV2 | undefined
    try {
      created = await store.create(imported.title || fallbackTitle)
      const result = await store.update(
        created.id,
        {
          ...imported,
          id: created.id,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt
        },
        created.revision
      )
      return unwrapMindMapUpdate(result, channel)
    } catch (error) {
      if (created) await store.remove(created.id).catch(() => undefined)
      const assetStore = new MindMapAssetStore({
        rootPath: join(resolve(rootPath), 'mindmap-assets')
      })
      await Promise.all(
        importedAssets.map((asset) => assetStore.remove(asset).catch(() => undefined))
      )
      throw error
    }
  }

  return [
    command({
      channel: teachingInvokeChannels.importMindMapFile,
      parser: (payload) => parseMindMapImportDialogPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapFile')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        // The native picker runs in the host so importing works identically on
        // macOS and Windows (a renderer `File` object cannot resolve an
        // on-disk path on every platform).
        const options: Electron.OpenDialogOptions = {
          title: '导入思维导图',
          properties: ['openFile', 'dontAddToRecent'],
          filters: [
            {
              name: 'Mind maps',
              extensions: [...MIND_MAP_IMPORT_EXTENSIONS]
            }
          ]
        }
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
        const sourcePath = result.filePaths[0]
        if (result.canceled || !sourcePath) return { canceled: true as const }

        const format = mindMapImportFormatForFileName(sourcePath)
        if (!format) {
          throw new Error('Unsupported mind-map import format.')
        }
        const imported = format === 'markdown'
          ? await importMindMapMarkdownFileWithAssets(sourcePath, root)
          : format === 'opml'
            ? await importMindMapOpmlFileWithAssets(sourcePath, root)
            : await importMindMapPortableFile(sourcePath, root)
        const document = await persistImportedMindMap(
          root,
          imported.document,
          '导入的思维导图',
          'importMindMapFile',
          imported.importedAssets
        )
        return { canceled: false as const, document }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.importMindMapMarkdown,
      parser: (payload) => parseMindMapMarkdownImportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapMarkdown')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const imported = await importMindMapMarkdownFileWithAssets(p.sourcePath, root)
        return persistImportedMindMap(
          root,
          imported.document,
          '导入的思维导图',
          'importMindMapMarkdown',
          imported.importedAssets
        )
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.importMindMapOpml,
      parser: (payload) => parseMindMapOpmlImportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapOpml')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const imported = await importMindMapOpmlFileWithAssets(p.sourcePath, root)
        return persistImportedMindMap(
          root,
          imported.document,
          '导入的思维导图',
          'importMindMapOpml',
          imported.importedAssets
        )
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.importMindMapPortable,
      parser: (payload) => parseMindMapPortableImportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapPortable')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const imported = await importMindMapPortableFile(p.sourcePath, root)
        return persistImportedMindMap(
          root,
          imported.document,
          '导入的思维导图',
          'importMindMapPortable',
          imported.importedAssets
        )
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapMarkdown,
      parser: (payload) => parseMindMapMarkdownExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapMarkdown')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot.  The renderer
        // proof is only advisory input; readiness is decided again here so a
        // stale or dirty candidate can never be serialized accidentally.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map Markdown export refused: ${readiness.reasons.join(', ')}`
          )
        }
        return exportMindMapMarkdownFile(doc, root, p.destinationDirectory)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapOpml,
      parser: (payload) => parseMindMapOpmlExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapOpml')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot.  The renderer
        // proof is only advisory input; readiness is decided again here so a
        // stale or dirty candidate can never be serialized accidentally.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map OPML export refused: ${readiness.reasons.join(', ')}`
          )
        }
        return exportMindMapOpmlFile(doc, root, p.destinationDirectory)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapPortable,
      parser: (payload) => parseMindMapPortableExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapPortable')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Keep the portable form behind the same durable snapshot proof as the
        // editable text exports: embedded media must match the canonical map.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map portable export refused: ${readiness.reasons.join(', ')}`
          )
        }
        return exportMindMapPortableFile(doc, root, p.destinationDirectory)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapSvg,
      parser: (payload) => parseMindMapSvgExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapSvg')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot.  The renderer
        // proof is only advisory input; readiness is decided again here so a
        // stale or dirty candidate can never be serialized accidentally.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map SVG export refused: ${readiness.reasons.join(', ')}`
          )
        }
        const sheet = doc.sheets.find((candidate) => candidate.id === p.sheetId)
        if (!sheet) {
          throw new Error(`Mind map SVG export refused: sheet ${p.sheetId} is unavailable`)
        }
        if (p.input.title !== sheet.title) {
          throw new Error('Mind map SVG export refused: layout title does not match the current sheet')
        }
        return exportMindMapSvgFile(p.input, p.destinationDirectory)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapPng,
      parser: (payload) => parseMindMapPngExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapPng')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot. The renderer
        // proof is advisory input; readiness is decided again in the host.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map PNG export refused: ${readiness.reasons.join(', ')}`
          )
        }
        const sheet = doc.sheets.find((candidate) => candidate.id === p.sheetId)
        if (!sheet) {
          throw new Error(`Mind map PNG export refused: sheet ${p.sheetId} is unavailable`)
        }
        if (p.input.title !== sheet.title) {
          throw new Error('Mind map PNG export refused: layout title does not match the current sheet')
        }
        return exportMindMapPngFile(
          { ...p, title: p.input.title },
          p.destinationDirectory,
          getMindMapSvgExportDimensions(p.input)
        )
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
  ]
}

/**
 * Re-export of the shared mind-map import format contract. The main-process
 * dialog owns format routing now; this module keeps the renderer import
 * surface stable for callers/tests.
 */
export {
  MIND_MAP_IMPORT_ACCEPT,
  MIND_MAP_IMPORT_EXTENSIONS,
  mindMapImportFormatForFileName,
  type MindMapImportFormat
} from '../../../../shared/mindmap/import-format'

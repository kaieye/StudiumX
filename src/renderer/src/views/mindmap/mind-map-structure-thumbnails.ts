import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'

/**
 * Small, original diagrams for the structure picker. The thumbnails are built
 * locally from simple SVG primitives so the picker remains offline-capable and
 * has a distinct visual language from any imported mind-map application.
 */

const COLORS: Record<'ink' | 'accent' | 'secondary' | 'fill' | 'warm', string> = {
  ink: '#30415f',
  accent: '#4f46e5',
  secondary: '#0f766e',
  fill: '#eef2ff',
  warm: '#fff7ed'
}

function thumbnail(content: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="${COLORS.ink}" stroke-width="1.6">${content}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const node = (x: number, y: number, w = 7, h = 5, fill = COLORS.fill, radius = 1.5) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${COLORS.accent}"/>`
const dot = (x: number, y: number, fill = COLORS.secondary) =>
  `<circle cx="${x}" cy="${y}" r="1.7" fill="${fill}" stroke="none"/>`

const THUMBNAILS: Record<MindMapStructureClass, string> = {
  'studiumx.layout.logic.right': thumbnail(`${node(3, 16, 8, 7, COLORS.warm)}<path d="M11 19.5h7M18 19.5v-9M18 19.5v9"/><path d="M18 10.5h5M18 28.5h5"/>${node(23, 8, 10, 5)}${node(23, 26, 10, 5)}`),
  'studiumx.layout.logic.balanced': thumbnail(`${node(15, 15, 10, 10, COLORS.warm)}<path d="M15 20H9M25 20h6M9 20v-7M9 20v7M31 20v-7M31 20v7"/>${node(2, 10, 7, 5)}${node(2, 25, 7, 5)}${node(31, 10, 7, 5)}${node(31, 25, 7, 5)}`),
  'studiumx.layout.logic.left': thumbnail(`${node(29, 16, 8, 7, COLORS.warm)}<path d="M29 19.5h-7M22 19.5v-9M22 19.5v9"/><path d="M22 10.5h-5M22 28.5h-5"/>${node(7, 8, 10, 5)}${node(7, 26, 10, 5)}`),
  'studiumx.layout.logic.map': thumbnail(`${node(14, 14, 12, 12, COLORS.warm, 3)}<path d="M14 20H8M26 20h6M20 14V8M20 26v6"/>${node(2, 6, 7, 5)}${node(31, 6, 7, 5)}${node(16, 2, 8, 5)}${node(16, 33, 8, 5)}`),
  'studiumx.layout.map': thumbnail(`${node(14, 14, 12, 12, COLORS.warm, 3)}<path d="M14 20H8M26 20h6M20 14V8M20 26v6"/>${node(2, 6, 7, 5)}${node(31, 6, 7, 5)}${node(16, 2, 8, 5)}${node(16, 33, 8, 5)}`),
  'studiumx.layout.map.clockwise': thumbnail(`${node(14, 14, 12, 12, COLORS.warm, 3)}<path d="M14 20H8M26 20h6M20 14V8M20 26v6"/>${node(2, 6, 7, 5)}${node(31, 6, 7, 5)}${node(16, 2, 8, 5)}${node(16, 33, 8, 5)}`),
  'studiumx.layout.map.anticlockwise': thumbnail(`${node(14, 14, 12, 12, COLORS.warm, 3)}<path d="M14 20H8M26 20h6M20 14V8M20 26v6"/>${node(2, 6, 7, 5)}${node(31, 6, 7, 5)}${node(16, 2, 8, 5)}${node(16, 33, 8, 5)}`),
  'studiumx.layout.logic.down': thumbnail(`${node(15, 3, 10, 7, COLORS.warm)}<path d="M20 10v6M20 16H10M20 16h10"/>${node(5, 20, 10, 6)}${node(25, 20, 10, 6)}<path d="M10 26v6M30 26v6"/>${dot(10, 34)}${dot(30, 34)}`),
  'studiumx.layout.logic.up': thumbnail(`${node(15, 30, 10, 7, COLORS.warm)}<path d="M20 30v-6M20 24H10M20 24h10"/>${node(5, 14, 10, 6)}${node(25, 14, 10, 6)}<path d="M10 14V8M30 14V8"/>${dot(10, 6)}${dot(30, 6)}`),
  'studiumx.layout.org-chart.down': thumbnail(`${node(15, 3, 10, 6, COLORS.warm)}<path d="M20 9v6M8 15h24M8 15v5M20 15v5M32 15v5"/>${node(3, 21, 10, 6)}${node(15, 21, 10, 6)}${node(27, 21, 10, 6)}`),
  'studiumx.layout.org-chart.up': thumbnail(`${node(15, 31, 10, 6, COLORS.warm)}<path d="M20 31v-6M8 25h24M8 25v-5M20 25v-5M32 25v-5"/>${node(3, 7, 10, 6)}${node(15, 7, 10, 6)}${node(27, 7, 10, 6)}`),
  'studiumx.layout.tree.right': thumbnail(`${node(3, 16, 8, 7, COLORS.warm)}<path d="M11 19.5h7M18 19.5v-9M18 19.5v9"/>${node(23, 8, 10, 5)}${node(23, 26, 10, 5)}<path d="M28 13v5M28 23v5"/>${dot(28, 6)}${dot(28, 34)}`),
  'studiumx.layout.tree.left': thumbnail(`${node(29, 16, 8, 7, COLORS.warm)}<path d="M29 19.5h-7M22 19.5v-9M22 19.5v9"/>${node(7, 8, 10, 5)}${node(7, 26, 10, 5)}<path d="M12 13v5M12 23v5"/>${dot(12, 6)}${dot(12, 34)}`),
  'studiumx.layout.brace.right': thumbnail(`${node(3, 16, 8, 7, COLORS.warm)}<path d="M11 19.5h6M17 19.5c7 0 2-10 10-10M17 19.5c7 0 2 10 10 10"/>${node(28, 7, 9, 6)}${node(28, 27, 9, 6)}`),
  'studiumx.layout.brace.left': thumbnail(`${node(29, 16, 8, 7, COLORS.warm)}<path d="M29 19.5h-6M23 19.5c-7 0-2-10-10-10M23 19.5c-7 0-2 10-10 10"/>${node(3, 7, 9, 6)}${node(3, 27, 9, 6)}`),
  'studiumx.layout.timeline.horizontal': thumbnail(`<path d="M4 20h32"/>${dot(7, 20)}${dot(16, 20, COLORS.accent)}${dot(25, 20)}${dot(34, 20, COLORS.accent)}<path d="M7 20v-7M16 20v7M25 20v-7M34 20v7"/>${node(3, 7, 8, 4)}${node(12, 27, 8, 4)}${node(21, 7, 8, 4)}${node(30, 27, 8, 4)}`),
  'studiumx.layout.timeline.vertical': thumbnail(`<path d="M20 4v32"/>${dot(20, 7)}${dot(20, 16, COLORS.accent)}${dot(20, 25)}${dot(20, 34, COLORS.accent)}<path d="M20 7h-7M20 16h7M20 25h-7M20 34h7"/>${node(3, 4, 8, 5)}${node(29, 13, 8, 5)}${node(3, 22, 8, 5)}${node(29, 31, 8, 5)}`),
  'studiumx.layout.spreadsheet': thumbnail(`${node(5, 6, 9, 8)}${node(16, 6, 9, 8)}${node(27, 6, 8, 8)}${node(5, 17, 9, 8, COLORS.warm)}${node(16, 17, 9, 8)}${node(27, 17, 8, 8)}${node(5, 28, 9, 6)}${node(16, 28, 9, 6)}${node(27, 28, 8, 6)}`),
  'studiumx.layout.spreadsheet.column': thumbnail(`${node(7, 5, 8, 8)}${node(17, 5, 8, 8, COLORS.warm)}${node(27, 5, 8, 8)}${node(7, 15, 8, 8)}${node(17, 15, 8, 8)}${node(27, 15, 8, 8)}${node(7, 25, 8, 8)}${node(17, 25, 8, 8)}${node(27, 25, 8, 8)}`),
  'studiumx.layout.fishbone.rightHeaded': thumbnail(`<path d="M4 28 34 12"/>${node(30, 8, 8, 5, COLORS.warm)}<path d="M12 24 9 16M17 21l-3-9M22 18l-2-8M12 24l2 6M17 21l3 8M22 18l4 7"/>${dot(9, 16)}${dot(14, 12)}${dot(20, 10)}${dot(14, 30)}${dot(20, 29)}${dot(26, 25)}`),
  'studiumx.layout.fishbone.leftHeaded': thumbnail(`<path d="M36 28 6 12"/>${node(2, 8, 8, 5, COLORS.warm)}<path d="M28 24l3-8M23 21l3-9M18 18l2-8M28 24l-2 6M23 21l-3 8M18 18l-4 7"/>${dot(31, 16)}${dot(26, 12)}${dot(20, 10)}${dot(26, 30)}${dot(20, 29)}${dot(14, 25)}`)
}

export function getMindMapStructureThumbnail(id: MindMapStructureClass): string | undefined {
  return THUMBNAILS[id]
}

import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'
import balancedMapClockwise from '../../assets/mindmap-structures/balanced-map-clockwise.svg'
import braceLeft from '../../assets/mindmap-structures/brace-left.svg'
import braceRight from '../../assets/mindmap-structures/brace-right.svg'
import fishboneLeft from '../../assets/mindmap-structures/fishbone-l.svg'
import fishboneRight from '../../assets/mindmap-structures/fishbone-r.svg'
import logicLeft from '../../assets/mindmap-structures/logic-left.svg'
import logicRight from '../../assets/mindmap-structures/logic-right.svg'
import map from '../../assets/mindmap-structures/map.svg'
import matrixColumn from '../../assets/mindmap-structures/matrix-column.svg'
import matrixRow from '../../assets/mindmap-structures/matrix-row.svg'
import orgDown from '../../assets/mindmap-structures/org-down.svg'
import orgUp from '../../assets/mindmap-structures/org-up.svg'
import timelineHorizontal from '../../assets/mindmap-structures/timeline-h.svg'
import timelineVertical from '../../assets/mindmap-structures/timeline-v.svg'
import treeLeft from '../../assets/mindmap-structures/tree-left.svg'
import treeRight from '../../assets/mindmap-structures/tree-right.svg'

/**
 * XMind's structure previews are intentionally kept as local, bundled assets.
 * The editor can therefore render the picker offline and in the packaged app.
 */
const THUMBNAILS: Record<MindMapStructureClass, string> = {
  'org.xmind.ui.logic.right': logicRight,
  'org.xmind.ui.logic.balanced': balancedMapClockwise,
  'org.xmind.ui.logic.left': logicLeft,
  'org.xmind.ui.logic.map': map,
  'org.xmind.ui.map': map,
  'org.xmind.ui.map.clockwise': balancedMapClockwise,
  'org.xmind.ui.map.anticlockwise': map,
  'org.xmind.ui.logic.down': orgDown,
  'org.xmind.ui.logic.up': orgUp,
  'org.xmind.ui.org-chart.down': orgDown,
  'org.xmind.ui.org-chart.up': orgUp,
  'org.xmind.ui.tree.right': treeRight,
  'org.xmind.ui.tree.left': treeLeft,
  'org.xmind.ui.brace.right': braceRight,
  'org.xmind.ui.brace.left': braceLeft,
  'org.xmind.ui.timeline.horizontal': timelineHorizontal,
  'org.xmind.ui.timeline.vertical': timelineVertical,
  'org.xmind.ui.spreadsheet': matrixRow,
  'org.xmind.ui.spreadsheet.column': matrixColumn,
  'org.xmind.ui.fishbone.rightHeaded': fishboneRight,
  'org.xmind.ui.fishbone.leftHeaded': fishboneLeft
}

export function getMindMapStructureThumbnail(id: MindMapStructureClass): string | undefined {
  return THUMBNAILS[id]
}

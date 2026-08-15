import type { ReactElement } from 'react'

/**
 * SVG marker icon set inspired by Xmind's marker system.
 *
 * Xmind organises markers into groups: priority, task/progress, flags,
 * stars, symbols, etc. Each marker is a small SVG icon
 * rendered inside a circular badge on the node.
 *
 * These are original SVG paths designed to visually echo the Xmind style
 * without copying proprietary assets.
 */

export type MarkerIconProps = {
  size?: number
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    'aria-hidden': true as const
  }
}

/* ---- Priority markers (numbered 1-9, coloured) ---- */

const PRIORITY_COLORS = ['#E74C3C', '#E67E22', '#F39C12', '#F1C40F', '#2ECC71', '#1ABC9C', '#3498DB', '#9B59B6', '#E74C3C']

export function PriorityMarkerIcon({ priority, size = 14 }: MarkerIconProps & { priority: number }): ReactElement {
  const color = PRIORITY_COLORS[Math.min(priority - 1, PRIORITY_COLORS.length - 1)] ?? '#E74C3C'
  return (
    <svg {...svgProps(size)}>
      <circle cx={8} cy={8} r={7} fill={color} stroke="white" strokeWidth={1} />
      <text x={8} y={8.5} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={9} fontWeight={700}>
        {priority}
      </text>
    </svg>
  )
}

/* ---- Task progress markers ---- */

export function TaskProgressMarkerIcon({ stage, size = 14 }: MarkerIconProps & { stage: 'not-started' | 'quarter' | 'half' | 'three-quarter' | 'done' }): ReactElement {
  const fractions: Record<string, number> = { 'not-started': 0, quarter: 0.25, half: 0.5, 'three-quarter': 0.75, done: 1 }
  const frac = fractions[stage] ?? 0
  const color = stage === 'done' ? '#27AE60' : '#3498DB'
  return (
    <svg {...svgProps(size)}>
      <circle cx={8} cy={8} r={6.5} fill="none" stroke="#E0E0E0" strokeWidth={2} />
      {frac > 0 && (
        <path
          d={describeArc(8, 8, 6.5, -90, -90 + frac * 360)}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      )}
      {stage === 'done' && (
        <path d="M5 8 L7 10 L11 6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle)
  const end = polarToCartesian(cx, cy, r, startAngle)
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/* ---- Flag markers ---- */

export function FlagMarkerIcon({ color, size = 14 }: MarkerIconProps & { color: string }): ReactElement {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 2 L4 14 M4 3 L12 3 L10 6 L12 9 L4 9" fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />
      <line x1={4} y1={2} x2={4} y2={14} stroke="#555" strokeWidth={1.2} />
    </svg>
  )
}

/* ---- Star markers ---- */

export function StarMarkerIcon({ color, size = 14 }: MarkerIconProps & { color: string }): ReactElement {
  return (
    <svg {...svgProps(size)}>
      <path
        d="M8 1.5 L9.8 5.8 L14.5 6.2 L11 9.3 L12 14 L8 11.5 L4 14 L5 9.3 L1.5 6.2 L6.2 5.8 Z"
        fill={color}
        stroke="white"
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ---- Symbol markers ---- */

export function SymbolMarkerIcon({ type, size = 14 }: MarkerIconProps & { type: 'idea' | 'important' | 'question' | 'warning' | 'check' | 'cross' | 'plus' | 'minus' }): ReactElement {
  const colorMap: Record<string, string> = {
    idea: '#F39C12', important: '#E74C3C', question: '#3498DB', warning: '#F39C12',
    check: '#27AE60', cross: '#E74C3C', plus: '#27AE60', minus: '#E74C3C'
  }
  const color = colorMap[type] ?? '#34495E'
  return (
    <svg {...svgProps(size)}>
      {type === 'idea' && (
        <>
          <path d="M8 1.5 C5.5 1.5 4 3.5 4 5.5 C4 7 5 8 5.5 9 L5.5 10.5 L10.5 10.5 L10.5 9 C11 8 12 7 12 5.5 C12 3.5 10.5 1.5 8 1.5 Z" fill={color} stroke="white" strokeWidth={0.5} />
          <rect x={6} y={11} width={4} height={1.5} rx={0.5} fill={color} />
          <rect x={6.5} y={13} width={3} height={1} rx={0.5} fill={color} />
        </>
      )}
      {type === 'important' && (
        <>
          <path d="M8 1 L14 12 L2 12 Z" fill={color} stroke="white" strokeWidth={0.5} strokeLinejoin="round" />
          <text x={8} y={10} textAnchor="middle" fill="white" fontSize={7} fontWeight={700}>!</text>
        </>
      )}
      {type === 'question' && (
        <>
          <circle cx={8} cy={8} r={6.5} fill={color} stroke="white" strokeWidth={0.8} />
          <text x={8} y={10.5} textAnchor="middle" fill="white" fontSize={8} fontWeight={700}>?</text>
        </>
      )}
      {type === 'warning' && (
        <>
          <path d="M8 1 L15 14 L1 14 Z" fill={color} stroke="white" strokeWidth={0.5} strokeLinejoin="round" />
          <rect x={7.3} y={5} width={1.4} height={5} rx={0.5} fill="white" />
          <circle cx={8} cy={12} r={0.8} fill="white" />
        </>
      )}
      {type === 'check' && (
        <>
          <circle cx={8} cy={8} r={6.5} fill={color} stroke="white" strokeWidth={0.8} />
          <path d="M5 8 L7 10.5 L11 6" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {type === 'cross' && (
        <>
          <circle cx={8} cy={8} r={6.5} fill={color} stroke="white" strokeWidth={0.8} />
          <path d="M5 5 L11 11 M11 5 L5 11" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {type === 'plus' && (
        <>
          <circle cx={8} cy={8} r={6.5} fill={color} stroke="white" strokeWidth={0.8} />
          <path d="M8 4 L8 12 M4 8 L12 8" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {type === 'minus' && (
        <>
          <circle cx={8} cy={8} r={6.5} fill={color} stroke="white" strokeWidth={0.8} />
          <path d="M4 8 L12 8" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

/* ---- Marker group definitions ---- */

export type MarkerDef = {
  id: string
  group: 'priority' | 'task' | 'flag' | 'star' | 'symbol'
  labelKey: string
  render: () => ReactElement
}

export const MARKER_DEFS: readonly MarkerDef[] = [
  // Priority
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    id: `priority-${n}`,
    group: 'priority' as const,
    labelKey: `priority${n}`,
    render: () => <PriorityMarkerIcon priority={n} />
  })),
  // Task progress
  { id: 'task-not-started', group: 'task', labelKey: 'taskNotStarted', render: () => <TaskProgressMarkerIcon stage="not-started" /> },
  { id: 'task-quarter', group: 'task', labelKey: 'taskQuarter', render: () => <TaskProgressMarkerIcon stage="quarter" /> },
  { id: 'task-half', group: 'task', labelKey: 'taskHalf', render: () => <TaskProgressMarkerIcon stage="half" /> },
  { id: 'task-three-quarter', group: 'task', labelKey: 'taskThreeQuarter', render: () => <TaskProgressMarkerIcon stage="three-quarter" /> },
  { id: 'task-done', group: 'task', labelKey: 'taskDone', render: () => <TaskProgressMarkerIcon stage="done" /> },
  // Flags
  ...['#E74C3C', '#E67E22', '#F1C40F', '#27AE60', '#3498DB', '#9B59B6', '#1ABC9C', '#34495E'].map((color, i) => {
    const names = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Teal', 'Dark']
    return {
      id: `flag-${names[i].toLowerCase()}`,
      group: 'flag' as const,
      labelKey: `flag${names[i]}`,
      render: () => <FlagMarkerIcon color={color} />
    }
  }),
  // Stars
  ...['#E74C3C', '#E67E22', '#F1C40F', '#27AE60', '#3498DB', '#9B59B6'].map((color, i) => {
    const names = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']
    return {
      id: `star-${names[i].toLowerCase()}`,
      group: 'star' as const,
      labelKey: `star${names[i]}`,
      render: () => <StarMarkerIcon color={color} />
    }
  }),
  // Symbols
  ...(['idea', 'important', 'question', 'warning', 'check', 'cross', 'plus', 'minus'] as const).map((type) => ({
    id: `symbol-${type}`,
    group: 'symbol' as const,
    labelKey: `symbol${type.charAt(0).toUpperCase() + type.slice(1)}`,
    render: () => <SymbolMarkerIcon type={type} />
  }))
]

export const MARKER_GROUPS: readonly { labelKey: string; markers: readonly MarkerDef[] }[] = [
  { labelKey: 'priority', markers: MARKER_DEFS.filter((m) => m.group === 'priority') },
  { labelKey: 'taskProgress', markers: MARKER_DEFS.filter((m) => m.group === 'task') },
  { labelKey: 'flags', markers: MARKER_DEFS.filter((m) => m.group === 'flag') },
  { labelKey: 'stars', markers: MARKER_DEFS.filter((m) => m.group === 'star') },
  { labelKey: 'symbols', markers: MARKER_DEFS.filter((m) => m.group === 'symbol') }
]

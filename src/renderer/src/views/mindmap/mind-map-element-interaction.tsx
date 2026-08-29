/**
 * Single interaction contract for every non-topic element kind on the canvas.
 *
 * The AI proposal surface can create any kind listed in
 * `MIND_MAP_PROPOSAL_ELEMENT_TYPES` (mind-map-proposal.ts), and the domain
 * union can grow — so the "how does the user select and remove this kind"
 * decision lives here once instead of being re-derived (and re-forgotten) at
 * every render site. Two fuses hang off this registry:
 *
 * 1. Compile time: `satisfies Record<MindMapElementType, …>` fails to build
 *    when a member joins the domain union without declaring its interaction.
 * 2. Runtime: the exhaustive canvas test (mind-map-element-interaction.unit
 *    .test.tsx) pointer-downs every declared hit target and asserts the
 *    element becomes selected, so a styling regression that swallows pointer
 *    events cannot ship unnoticed. This is the guard that keeps "the AI added
 *    an element I cannot remove" from regressing one element kind at a time.
 */
import type { ReactElement } from 'react'
import type { MindMapElementType } from '../../../../shared/mindmap/domain/types'

/** How an element kind's invisible hit target captures pointers. */
export type MindMapElementHitMode = 'stroke' | 'fill'

export type MindMapElementInteractionSpec =
  | {
      /** The canvas renders an invisible hit target for the kind. */
      presence: 'hit-target'
      /** CSS selector locating the hit target (also used by the fuse test). */
      hitSelector: string
      hitMode: MindMapElementHitMode
      /**
       * How the marquee sweep picks the kind up. Compact kinds intersect the
       * box; a frame-like kind only joins when the box fully contains it, so
       * sweeping inside a branch never silently grabs its enclosing frame.
       */
      marquee: 'intersect' | 'contain'
    }
  | {
      /**
       * The kind has no canvas representation of its own; its presence is
       * rendered through another surface. `note` documents that delegation so
       * the registry stays the one place that explains every kind.
       */
      presence: 'delegated'
      note: string
    }

export const MIND_MAP_ELEMENT_INTERACTION = {
  relationship: {
    presence: 'hit-target',
    hitSelector: '.mindmap-relationship-hit',
    hitMode: 'stroke',
    marquee: 'intersect'
  },
  boundary: {
    presence: 'hit-target',
    hitSelector: '.mindmap-boundary-hit',
    hitMode: 'stroke',
    marquee: 'contain'
  },
  summary: {
    presence: 'hit-target',
    hitSelector: '.mindmap-summary-hit',
    hitMode: 'stroke',
    marquee: 'intersect'
  },
  callout: {
    presence: 'hit-target',
    hitSelector: '.mindmap-callout-hit',
    hitMode: 'fill',
    marquee: 'intersect'
  },
  shape: {
    presence: 'hit-target',
    hitSelector: '.mindmap-drawn-shape',
    hitMode: 'fill',
    marquee: 'intersect'
  },
  connector: {
    presence: 'hit-target',
    hitSelector: '.mindmap-drawn-line-hit',
    hitMode: 'stroke',
    marquee: 'intersect'
  },
  'free-topic': {
    presence: 'delegated',
    note: 'Renders through its referenced topic node. The layout does not consume element.position yet, so the element itself paints nothing and is not directly selectable; it disappears with its topic via the reducer cascade. Keep it out of the AI proposal surface (see MIND_MAP_PROPOSAL_ELEMENT_TYPES) until free positioning is actually rendered.'
  }
} satisfies Record<MindMapElementType, MindMapElementInteractionSpec>

/** Screen-constant minimum band width (document pixels) for stroke hit targets. */
const HIT_BAND_MIN_WIDTH = 12

/**
 * The invisible pointer target every hit-target element kind renders. Keeping
 * the class and pointer-events wiring here means an element renderer only
 * supplies geometry and cannot drift from the registry contract.
 */
export function MindMapElementHitTarget(props: {
  kind: MindMapElementType
  d: string
  /** The kind's visible stroke width; the band pads it to a forgiving width. */
  strokeWidth?: number
}): ReactElement | null {
  const spec = MIND_MAP_ELEMENT_INTERACTION[props.kind]
  if (spec.presence !== 'hit-target') return null
  return (
    <path
      className={spec.hitSelector.slice(1)}
      d={props.d}
      fill={spec.hitMode === 'fill' ? 'transparent' : 'none'}
      stroke={spec.hitMode === 'stroke' ? 'transparent' : 'none'}
      strokeWidth={spec.hitMode === 'stroke'
        ? Math.max(HIT_BAND_MIN_WIDTH, (props.strokeWidth ?? 1.5) + HIT_BAND_MIN_WIDTH)
        : undefined}
      vectorEffect={spec.hitMode === 'stroke' ? 'non-scaling-stroke' : undefined}
      pointerEvents={spec.hitMode === 'stroke' ? 'stroke' : 'all'}
      aria-hidden="true"
    />
  )
}

import type { MindMapElement } from './types'

/**
 * Topic title lookup used when describing element references for assistive
 * technology. Missing or blank titles intentionally fall back to the stable
 * topic id so an element never loses its target context.
 */
export type MindMapElementTopicTitleLookup = ReadonlyMap<string, string>

/**
 * Build a concise, deterministic accessible name for a structural element.
 *
 * The renderer can place this value on a future relationship/boundary/summary
 * hit target without teaching the SVG layer how each element stores its topic
 * references. Labels remain optional metadata and are appended only when they
 * contain visible text.
 */
export function buildMindMapElementAccessibleLabel(
  element: MindMapElement,
  topicTitles: MindMapElementTopicTitleLookup = new Map()
): string {
  const label = cleanElementLabel(element.label)

  let description: string
  switch (element.type) {
    case 'relationship':
      description = `Relationship from ${topicName(element.from, topicTitles)} to ${topicName(element.to, topicTitles)}`
      break
    case 'boundary':
      description = `Boundary around ${topicName(element.topicId, topicTitles)}`
      break
    case 'summary':
      description = `Summary from ${topicName(element.from, topicTitles)} to ${topicName(element.to, topicTitles)}`
      if (element.summaryTopicId !== undefined) {
        description += ` with output topic ${topicName(element.summaryTopicId, topicTitles)}`
      }
      break
    case 'callout':
      description = `Callout on ${topicName(element.topicId, topicTitles)}`
      break
    case 'free-topic':
      description = `Free topic ${topicName(element.topicId, topicTitles)}`
      break
  }

  return label === undefined ? description : `${description}: ${label}`
}

function topicName(topicId: string, topicTitles: MindMapElementTopicTitleLookup): string {
  const title = topicTitles.get(topicId)?.trim()
  return title || topicId
}

function cleanElementLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim()
  return trimmed === '' ? undefined : trimmed
}

import type { MindMapTopicV2 } from './types'

/**
 * Filter a topic tree for a case-insensitive title query.
 *
 * The returned tree contains every matching topic plus the complete ancestor
 * path needed to reach each match. Branches that contain neither a matching
 * topic nor a matching descendant are omitted. Topic and child objects are
 * cloned, so callers can safely use the result as a view without mutating the
 * document that supplied it.
 *
 * An empty (or whitespace-only) query means "show all" and returns a deep
 * clone of the input tree. A non-empty query with no matches returns `null`.
 */
export function filterMindMapTopicTree(
  root: MindMapTopicV2,
  query: string
): MindMapTopicV2 | null {
  const normalizedQuery = normalizeMindMapTreeFilterQuery(query)
  if (normalizedQuery.length === 0) return cloneMindMapTopic(root)

  return filterTopic(root, normalizedQuery)
}

function filterTopic(topic: MindMapTopicV2, normalizedQuery: string): MindMapTopicV2 | null {
  const matchingChildren: MindMapTopicV2[] = []
  for (const child of topic.children) {
    const filteredChild = filterTopic(child, normalizedQuery)
    if (filteredChild !== null) matchingChildren.push(filteredChild)
  }

  const titleMatches = topic.title.toLowerCase().includes(normalizedQuery)
  if (!titleMatches && matchingChildren.length === 0) return null

  return cloneMindMapTopic(topic, matchingChildren)
}

function normalizeMindMapTreeFilterQuery(query: string): string {
  return query.trim().toLowerCase()
}

function cloneMindMapTopic(
  topic: MindMapTopicV2,
  children: MindMapTopicV2[] = topic.children.map((child) => cloneMindMapTopic(child))
): MindMapTopicV2 {
  // Clone the topic metadata without cloning the original subtree first. This
  // keeps filtering linear in the number of visited topics instead of cloning
  // every retained ancestor's entire original descendant tree repeatedly.
  const clone = structuredClone({ ...topic, children: [] as MindMapTopicV2[] })
  clone.children = children
  return clone
}

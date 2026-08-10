import type { MindMapTopicUpdatePatch } from '../../../../shared/mindmap/commands'
import type { MindMapLink, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'

export type MindMapSearchField = 'title' | 'note' | 'label' | 'link'

export type MindMapSearchMatch = {
  nodeId: string
  title: string
  fields: MindMapSearchField[]
}

/**
 * Search the in-memory topic tree without involving product search indexes.
 * A node appears once even when several of its fields match; `fields` keeps
 * enough information for the UI to explain why it matched.
 */
export function searchMindMapTopics(root: MindMapTopicV2, query: string): MindMapSearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) return []

  const matches: MindMapSearchMatch[] = []
  visit(root, normalizedQuery, matches)
  return matches
}

/**
 * Build one command patch that replaces all occurrences in a topic's title,
 * note, labels, and links. The caller is responsible for dispatching the
 * resulting topic.update command (or a transaction of several commands).
 */
export function buildMindMapTextReplacementPatch(
  topic: MindMapTopicV2,
  query: string,
  replacement: string
): MindMapTopicUpdatePatch | null {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length === 0) return null

  const replaceText = createCaseInsensitiveReplacer(normalizedQuery, replacement)
  const patch: MindMapTopicUpdatePatch = {}
  let changed = false

  const nextTitle = replaceText(topic.title)
  if (nextTitle !== topic.title) {
    patch.title = nextTitle
    changed = true
  }

  if (topic.note !== undefined) {
    const nextNote = replaceText(topic.note)
    if (nextNote !== topic.note) {
      patch.note = nextNote.length === 0 ? null : nextNote
      changed = true
    }
  }

  if (topic.labels !== undefined) {
    const nextLabels = topic.labels
      .map((label) => replaceText(label))
      .filter((label) => label.trim().length > 0)
    if (!arraysEqual(nextLabels, topic.labels)) {
      patch.labels = nextLabels
      changed = true
    }
  }

  if (topic.links !== undefined) {
    const nextLinks = topic.links.map((link) => replaceLinkText(link, replaceText))
    if (!linksEqual(nextLinks, topic.links)) {
      patch.links = nextLinks
      changed = true
    }
  }

  return changed ? patch : null
}

function visit(node: MindMapTopicV2, normalizedQuery: string, matches: MindMapSearchMatch[]): void {
  const fields: MindMapSearchField[] = []
  if (node.title.toLowerCase().includes(normalizedQuery)) fields.push('title')
  if (node.note?.toLowerCase().includes(normalizedQuery)) fields.push('note')
  if (node.labels?.some((label) => label.toLowerCase().includes(normalizedQuery))) fields.push('label')
  if (
    node.links?.some(
      (link) =>
        link.url.toLowerCase().includes(normalizedQuery) ||
        link.title?.toLowerCase().includes(normalizedQuery) === true
    )
  ) {
    fields.push('link')
  }

  if (fields.length > 0) matches.push({ nodeId: node.id, title: node.title, fields })
  for (const child of node.children) visit(child, normalizedQuery, matches)
}

function createCaseInsensitiveReplacer(query: string, replacement: string): (value: string) => string {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(escaped, 'giu')
  // Use a replacer callback so user text such as `$&` stays literal instead
  // of being interpreted as String.replace substitution syntax.
  return (value) => value.replace(pattern, () => replacement)
}

function replaceLinkText(link: MindMapLink, replaceText: (value: string) => string): MindMapLink {
  const next: MindMapLink = { ...link, url: replaceText(link.url) }
  if (link.title !== undefined) {
    const nextTitle = replaceText(link.title)
    if (nextTitle.length > 0 || nextTitle === link.title) next.title = nextTitle
    else delete next.title
  }
  return next
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function linksEqual(left: MindMapLink[], right: MindMapLink[]): boolean {
  if (left.length !== right.length) return false
  return left.every((link, index) => {
    const other = right[index]
    return link.url === other.url && link.title === other.title && link.id === other.id
  })
}

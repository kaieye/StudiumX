import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { isAgentConversationMarkdownRelativePath } from '../../shared/agent-conversation-catalog'
import type { ResourceSummary, TeachingWorkspaceSummary } from '../../shared/teaching-types'
import {
  cleanText,
  collectTeachingFiles,
  compactMarkdown,
  formatDate,
  titleFromFilename,
  toWorkspaceRelativePath
} from '../teaching-workspace-paths'

const MISSION_FILE = 'MISSION.md'
const RESOURCES_FILE = 'RESOURCES.md'
const LEARNING_RECORDS_DIRECTORY = 'learning-records'
const REFERENCE_DIRECTORY = 'reference'
const REFERENCE_FILE_SUFFIX = '-reference.html'
const MAX_RESOURCE_SUMMARIES = 8
const MAX_LEARNING_RECORDS = 8

export type LearningAssetCatalog = {
  missionPath: string
  resourcesPath: string
  recordsDir: string
  referenceDir: string
  mission: {
    title: string
    excerpt: string
  }
  resources: ResourceSummary[]
  records: TeachingWorkspaceSummary['records']
  referenceCount: number
}

/**
 * Reads the durable, non-session learning assets that frame a Teaching workspace.
 * Lesson placement and Course/Session projection deliberately remain outside this
 * boundary; this module only owns the filesystem conventions for Mission,
 * resources, learning records, and reference files.
 */
export async function readLearningAssetCatalog(
  rootPath: string,
  workspaceName: string
): Promise<LearningAssetCatalog> {
  const [mission, resources, records, referenceFiles] = await Promise.all([
    readMissionSummary(rootPath, workspaceName),
    readResources(rootPath),
    readLearningRecords(rootPath),
    collectTeachingFiles(rootPath, isReferenceFile)
  ])

  return {
    missionPath: join(rootPath, MISSION_FILE),
    resourcesPath: join(rootPath, RESOURCES_FILE),
    recordsDir: join(rootPath, LEARNING_RECORDS_DIRECTORY),
    referenceDir: join(rootPath, REFERENCE_DIRECTORY),
    mission,
    resources,
    records,
    referenceCount: referenceFiles.length
  }
}

export async function readMissionSummary(rootPath: string, fallbackName: string): Promise<LearningAssetCatalog['mission']> {
  const content = await readFile(join(rootPath, MISSION_FILE), 'utf8').catch(() => '')
  const title = /^#\s+Mission:\s*(.+)$/m.exec(content)?.[1] ?? /^#\s+(.+)$/m.exec(content)?.[1] ?? fallbackName
  const excerpt = /##\s+Why\s+([\s\S]*?)(?:\n##\s+|$)/m.exec(content)?.[1] ?? content
  return {
    title: cleanText(title),
    excerpt: compactMarkdown(excerpt) || '等待补充学习使命。'
  }
}

async function readResources(rootPath: string): Promise<ResourceSummary[]> {
  const content = await readFile(join(rootPath, RESOURCES_FILE), 'utf8').catch(() => '')
  const rows: ResourceSummary[] = []
  let currentSection = '资源'
  for (const line of content.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      currentSection = heading[1]!.trim()
      continue
    }
    if (!line.startsWith('- ')) continue
    const item = line.slice(2).trim()
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/.exec(item)
    const localMatch = /^([^:]+):\s*(.+)$/.exec(item)
    const title = linkMatch?.[1] ?? localMatch?.[1] ?? item.split(' — ')[0] ?? item
    const detail = compactMarkdown(linkMatch?.[3] ?? localMatch?.[2] ?? item.split(' — ').slice(1).join(' — ')) || '已记录在资源索引中。'
    rows.push({ title: cleanText(title), detail, tag: currentSection })
  }
  return rows.length > 0
    ? rows.slice(0, MAX_RESOURCE_SUMMARIES)
    : [{ title: RESOURCES_FILE, detail: '等待添加首批可信资源。', tag: 'Gaps' }]
}

async function readLearningRecords(rootPath: string): Promise<TeachingWorkspaceSummary['records']> {
  const files = await collectTeachingFiles(rootPath, isLearningRecordFile(rootPath))
  return Promise.all(
    files
      .sort()
      .reverse()
      .slice(0, MAX_LEARNING_RECORDS)
      .map(async (absolutePath) => {
        const file = basename(absolutePath)
        const content = await readFile(absolutePath, 'utf8').catch(() => '')
        const info = await stat(absolutePath).catch(() => null)
        return {
          title: cleanText(/^#\s+(.+)$/m.exec(content)?.[1] ?? titleFromFilename(file)),
          date: formatDate(info?.mtime ?? new Date()),
          relativePath: toWorkspaceRelativePath(rootPath, absolutePath),
          absolutePath
        }
      })
  )
}

function isReferenceFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(REFERENCE_FILE_SUFFIX)
}

function isLearningRecordFile(rootPath: string): (filePath: string) => boolean {
  return (filePath) => {
    if (!filePath.toLowerCase().endsWith('.md')) return false
    const name = basename(filePath)
    if (
      name.startsWith('MISSION') ||
      name.startsWith('RESOURCES') ||
      name.startsWith('GLOSSARY') ||
      name.startsWith('NOTES')
    ) return false
    return !isAgentConversationMarkdownRelativePath(toWorkspaceRelativePath(rootPath, filePath))
  }
}

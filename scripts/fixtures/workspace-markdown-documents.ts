import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listSidebarWorkspaceFolders } from '../../src/shared/course-sidebar'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import {
  ensurePreviewBaseTag,
  injectPreviewMarkdownLinkBridge,
  parsePreviewExternalHref,
  parsePreviewMarkdownHref,
  PREVIEW_EXTERNAL_LINK_MESSAGE,
  PREVIEW_MARKDOWN_LINK_MESSAGE,
  PREVIEW_PROTOCOL
} from '../../src/shared/preview-markdown-bridge'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-workspace-markdown-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'studiumx-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => defaultSettings(defaultRoot)
  })

  const created = await service.createWorkspace({ name: 'markdown-course', prompt: '学习 markdown 文档' })
  const workspace = created.activeWorkspace
  assert.ok(workspace)

  assert.equal(
    await stat(join(workspace.rootPath, 'MISSION.md')).then((info) => info.isFile()).catch(() => false),
    true,
    'new workspaces should have a root MISSION.md'
  )
  assert.equal(
    await stat(join(workspace.rootPath, 'GLOSSARY.md')).then((info) => info.isFile()).catch(() => false),
    true,
    'new workspaces should have a root GLOSSARY.md'
  )
  assert.equal(
    await stat(join(workspace.rootPath, 'RESOURCES.md')).then((info) => info.isFile()).catch(() => false),
    true,
    'new workspaces should have a root RESOURCES.md'
  )

  const sidebarRoot = listSidebarWorkspaceFolders(created.workspaces, false).find(({ workspace: item }) => item.id === workspace.id)?.node
  assert.ok(sidebarRoot)
  assert.deepEqual(
    sidebarRoot.children?.map((node) => node.relativePath).slice(0, 6),
    ['lessons', 'conversation', 'MISSION.md', 'GLOSSARY.md', 'RESOURCES.md', 'NOTES.md'],
    'course sidebar should list lesson/conversation folders before sibling markdown files'
  )
  assert.deepEqual(
    sidebarRoot.children
      ?.filter((node) => node.kind === 'file' && node.name.endsWith('.md'))
      .map((node) => node.relativePath)
      .sort(),
    ['GLOSSARY.md', 'MISSION.md', 'NOTES.md', 'RESOURCES.md'],
    'course sidebar should expose mission, glossary, resources, and notes markdown files'
  )

  const mission = await service.readWorkspaceMarkdown({
    workspaceId: workspace.id,
    documentPath: 'MISSION.md'
  })
  assert.equal(mission.relativePath, 'MISSION.md')
  assert.match(mission.content, /^# Mission:/m)

  const saved = await service.saveWorkspaceMarkdown({
    workspaceId: workspace.id,
    documentPath: 'GLOSSARY.md',
    content: '# Glossary\n\n- Term：Definition\n'
  })
  assert.equal(saved.document.content, '# Glossary\n\n- Term：Definition\n')
  assert.equal(await readFile(join(workspace.rootPath, 'GLOSSARY.md'), 'utf8'), saved.document.content)
  assert.equal(saved.state.selectedLessonPath, join(workspace.rootPath, 'GLOSSARY.md'))

  const previewFile = await service.resolvePreviewFile(workspace.id, 'RESOURCES.md')
  assert.equal(previewFile?.mimeType, 'text/markdown; charset=utf-8')

  const lessonDir = join(workspace.rootPath, 'courses', 'demo', 'lesson')
  await mkdir(lessonDir, { recursive: true })
  await writeFile(
    join(lessonDir, '0001-md-nav.html'),
    '<!doctype html><html><head><title>md nav</title></head><body><a href="../../../MISSION.md">Mission</a></body></html>',
    'utf8'
  )
  const lessonPreview = await service.readLesson({
    workspaceId: workspace.id,
    lessonPath: 'courses/demo/lesson/0001-md-nav.html'
  })
  assert.match(
    lessonPreview.html,
    new RegExp(PREVIEW_MARKDOWN_LINK_MESSAGE),
    'lesson preview HTML should intercept Markdown links instead of letting the iframe navigate to raw text'
  )
  assert.match(
    lessonPreview.html,
    new RegExp(PREVIEW_EXTERNAL_LINK_MESSAGE),
    'lesson preview HTML should intercept external links instead of letting the iframe navigate away from StudiumX'
  )
  assert.deepEqual(
    parsePreviewMarkdownHref(`${PREVIEW_PROTOCOL}://${encodeURIComponent(workspace.id)}/MISSION.md`),
    { workspaceId: workspace.id, relativePath: 'MISSION.md' },
    'preview markdown bridge should parse studiumx-preview Markdown links for the app shell'
  )
  assert.equal(
    parsePreviewExternalHref('https://example.com/docs?x=1#intro'),
    'https://example.com/docs?x=1#intro',
    'preview bridge should allow http(s) external links'
  )
  assert.equal(
    parsePreviewExternalHref(`${PREVIEW_PROTOCOL}://${encodeURIComponent(workspace.id)}/MISSION.md`),
    null,
    'preview bridge should not treat internal preview links as external links'
  )
  const protocolPreviewFile = await service.resolvePreviewFile(workspace.id, 'courses/demo/lesson/0001-md-nav.html')
  assert.equal(protocolPreviewFile?.relativePath, 'courses/demo/lesson/0001-md-nav.html')
  assert.equal(protocolPreviewFile?.workspaceId, workspace.id)
  assert.equal(protocolPreviewFile?.mimeType, 'text/html; charset=utf-8')
  const protocolPreviewUrl = `${PREVIEW_PROTOCOL}://${encodeURIComponent(workspace.id)}/courses/demo/lesson/0001-md-nav.html`
  const protocolHtml = injectPreviewMarkdownLinkBridge(
    ensurePreviewBaseTag(await readFile(protocolPreviewFile.absolutePath, 'utf8'), protocolPreviewUrl)
  )
  assert.match(
    protocolHtml,
    new RegExp(`<base href="${protocolPreviewUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
    'preview protocol HTML should receive a studiumx-preview base tag'
  )
  assert.match(
    protocolHtml,
    new RegExp(PREVIEW_MARKDOWN_LINK_MESSAGE),
    'preview protocol HTML should intercept Markdown links before the iframe navigates to raw text'
  )
  assert.match(
    protocolHtml,
    new RegExp(PREVIEW_EXTERNAL_LINK_MESSAGE),
    'preview protocol HTML should intercept external links before the iframe navigates away from StudiumX'
  )

  await assert.rejects(
    service.readWorkspaceMarkdown({ workspaceId: workspace.id, documentPath: '../outside.md' }),
    /outside the allowed workspace documents/,
    'markdown reads should reject paths outside the workspace'
  )
  await assert.rejects(
    service.saveWorkspaceMarkdown({ workspaceId: workspace.id, documentPath: 'assets/lesson.css', content: 'bad' }),
    /outside the allowed workspace documents/,
    'markdown writes should reject non-markdown files'
  )

  console.log('workspace markdown documents ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

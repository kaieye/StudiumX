/**
 * Controlled workspace file edit tool (ADR-0005).
 *
 * Local string replace with Exact → EOL/BOM → trailing-whitespace → indent-tolerant
 * matching. Shares path fence, workspace_write permission, durable pathname overwrite,
 * and write-rewind journal with write_workspace_file. No Shell / apply_patch product path.
 */

import type { ToolEntry, ToolContext } from './registry'
import {
  resolveWorkspacePathTarget,
  verifyExistingWorkspaceTarget,
} from './workspace-path-target'
import { captureAndAppendWritePreImage } from './write-rewind-journal'
import { readToolPathArg, requireToolPathArg } from './tool-arguments'
import {
  applyEditReplacements,
  findEditMatches,
  type EditMatchStrategy
} from './edit-match'
import {
  MAX_WRITE_BYTES,
  defaultWorkspaceWriteDurableDependencies,
  workspaceWriteErrorMessages,
  workspaceWritePermissionDescriptionError,
  jsonResult,
  isProtectedWorkspaceRelativePath,
  isLessonHtmlRelativePath,
  isLikelyTextPath,
  readTextFile,
  isPossiblyPublishedWorkspaceWriteError,
  stableErrorForDurablePublicationFailure,
  canonicalWorkspaceWriteReadIsExact,
  type WorkspaceWriteDurableDependencies,
  type WorkspaceWriteStableError
} from './workspace'

type WorkspaceEditStableError =
  | WorkspaceWriteStableError
  | 'match_failed'
  | 'ambiguous_match'

const workspaceEditErrorMessages: Record<WorkspaceEditStableError, string> = {
  ...workspaceWriteErrorMessages,
  match_failed: '未能在文件中唯一定位 old_string；未写入任何内容。',
  ambiguous_match: 'old_string 匹配到多处；请提供更具体的上下文或设置 replace_all。未写入任何内容。'
}

function stableWorkspaceEditError(
  code: WorkspaceEditStableError,
  path?: string,
  message = workspaceEditErrorMessages[code],
  extras?: Record<string, unknown>
): string {
  return jsonResult({
    tool: 'edit_workspace_file',
    ...(path ? { path } : {}),
    error: message,
    code,
    ...(code === 'possibly_published' ? { retryable: false } : {}),
    ...extras
  })
}

async function describeWorkspaceEditPermission(args: unknown, ctx: ToolContext): Promise<{
  operation: string
  targetPath: string
  reason: string
  creates: boolean
}> {
  const path = requireToolPathArg(args)
  try {
    const target = resolveWorkspacePathTarget(ctx.workspaceRoot, path)
    return {
      operation: '局部编辑工作区文件',
      targetPath: target.relativePath,
      reason: '模型请求对已有教学资产做局部字符串替换。',
      creates: false
    }
  } catch {
    throw new Error(workspaceWritePermissionDescriptionError)
  }
}

/**
 * Internal handler seam for tests. Production uses pathname overwrite publisher.
 */
export async function runWorkspaceEditWithDurableDependenciesForTesting(
  args: unknown,
  ctx: ToolContext,
  dependencies: WorkspaceWriteDurableDependencies = defaultWorkspaceWriteDurableDependencies
): Promise<string> {
  const input = (args ?? {}) as {
    path?: string
    old_string?: unknown
    new_string?: unknown
    replace_all?: unknown
  }
  const path = readToolPathArg(args).path ?? (typeof input.path === 'string' ? input.path.trim() : '')
  if (!path || typeof input.old_string !== 'string' || typeof input.new_string !== 'string') {
    return stableWorkspaceEditError('request_rejected')
  }
  if (!input.old_string) {
    return stableWorkspaceEditError('request_rejected', undefined, 'old_string 不能为空。')
  }

  let target: ReturnType<typeof resolveWorkspacePathTarget>
  try {
    target = resolveWorkspacePathTarget(ctx.workspaceRoot, path)
  } catch {
    return stableWorkspaceEditError('path_rejected')
  }

  try {
    if (isProtectedWorkspaceRelativePath(target.relativePath)) {
      return stableWorkspaceEditError(
        'path_rejected',
        target.relativePath,
        '该路径属于隐藏、构建或敏感文件范围，已拒绝写入。'
      )
    }
    if (isLessonHtmlRelativePath(target.relativePath)) {
      return stableWorkspaceEditError(
        'path_rejected',
        target.relativePath,
        '课程页面不能用 edit_workspace_file 直接写入 lessons/ 目录。请调用 generate_lesson 工具生成本节课程。'
      )
    }
    if (!isLikelyTextPath(target.relativePath)) {
      return stableWorkspaceEditError('path_rejected', target.relativePath, '仅允许编辑文本文件类型。')
    }
    if (target.relativePath === '.') {
      return stableWorkspaceEditError('path_rejected', target.relativePath)
    }
  } catch {
    return stableWorkspaceEditError('request_rejected', target.relativePath)
  }

  let existingText: string
  try {
    await verifyExistingWorkspaceTarget(target)
    existingText = await readTextFile(target.absolutePath, MAX_WRITE_BYTES)
  } catch {
    return stableWorkspaceEditError('target_changed', target.relativePath, '目标文件不存在或不可读。')
  }

  const outcome = findEditMatches(existingText, input.old_string, input.new_string)
  if (!outcome) {
    return stableWorkspaceEditError('match_failed', target.relativePath)
  }

  const replaceAll = input.replace_all === true
  if (!replaceAll && outcome.replacements.length > 1) {
    return stableWorkspaceEditError('ambiguous_match', target.relativePath, undefined, {
      matchCount: outcome.replacements.length,
      matchStrategy: outcome.strategy as EditMatchStrategy
    })
  }

  const replacements = replaceAll ? outcome.replacements : outcome.replacements.slice(0, 1)
  const nextContent = applyEditReplacements(existingText, replacements)
  if (Buffer.byteLength(nextContent, 'utf8') > MAX_WRITE_BYTES) {
    return stableWorkspaceEditError('request_rejected', target.relativePath)
  }

  const bytes = Buffer.byteLength(nextContent, 'utf8')
  const expectedBytes = Buffer.from(nextContent, 'utf8')
  const matchStrategy = outcome.strategy

  if (ctx.runId && ctx.workspaceRoot) {
    try {
      await captureAndAppendWritePreImage({
        workspaceRoot: ctx.workspaceRoot,
        relativePath: target.relativePath,
        runId: ctx.runId,
        content: nextContent,
        ...(ctx.lastJournalPermissionDecision
          ? { permissionDecision: ctx.lastJournalPermissionDecision }
          : {})
      })
    } catch {
      // Journal failures must not block durable publication.
    }
  }

  try {
    await dependencies.overwriteExistingRestricted({
      workspaceRootPath: target.root,
      relativePath: target.relativePath,
      content: nextContent
    })
    return jsonResult({
      path: target.relativePath,
      bytes,
      created: false,
      overwritten: true,
      matchStrategy,
      replacements: replacements.length,
      message: `已编辑 ${target.relativePath}（${matchStrategy}）`
    })
  } catch (error) {
    if (!isPossiblyPublishedWorkspaceWriteError(error)) {
      return stableWorkspaceEditError(
        stableErrorForDurablePublicationFailure(error, 'overwritten'),
        target.relativePath
      )
    }

    if (
      await canonicalWorkspaceWriteReadIsExact({
        workspaceRootPath: target.root,
        relativePath: target.relativePath,
        expectedBytes,
        dependencies
      })
    ) {
      return jsonResult({
        path: target.relativePath,
        bytes,
        created: false,
        overwritten: true,
        matchStrategy,
        replacements: replacements.length,
        possiblyPublished: true,
        canonicalRead: 'exact',
        retryable: false,
        message: '文件可能已发布；已通过受控读取确认其内容与请求完全一致。'
      })
    }
    return stableWorkspaceEditError('possibly_published', target.relativePath)
  }
}

export const editWorkspaceFileTool: ToolEntry = {
  definition: {
    type: 'function',
    function: {
      name: 'edit_workspace_file',
      description:
        '对当前 StudiumX 教学工作区内已有文本文件做局部字符串替换。按 Exact → EOL/BOM → 行尾空白 → 统一缩进 四级容错匹配；成功时返回 matchStrategy。错匹配不会静默写入。限定在当前工作区内；与 write_workspace_file 共用 path 围栏、审批与 write-rewind journal。lessons/ 下课程 HTML 请用 generate_lesson。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '相对工作区文件路径。参数名必须是 path（也接受 file_path）。'
          },
          old_string: {
            type: 'string',
            description: '要替换的原文片段（不可为空）。'
          },
          new_string: {
            type: 'string',
            description: '替换后的文本（可为 empty 表示删除匹配片段）。'
          },
          replace_all: {
            type: 'boolean',
            description: '为 true 时替换全部非重叠匹配；默认 false，多处匹配则失败。'
          }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  permission: {
    kind: 'workspace_write',
    describe: describeWorkspaceEditPermission
  },
  handler: async (args: unknown, ctx: ToolContext): Promise<string> =>
    runWorkspaceEditWithDurableDependenciesForTesting(args, ctx)
}


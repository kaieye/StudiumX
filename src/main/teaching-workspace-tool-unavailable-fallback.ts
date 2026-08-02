/**
 * Host-authored recovery for a model ending a turn with a promise to read files
 * that are not available on this turn. This is intentionally narrow: it only
 * catches an affirmative, unfinished workspace-read intent, never a complete
 * teaching answer that merely mentions a workspace.
 */
export const WORKSPACE_TOOL_UNAVAILABLE_FALLBACK =
  '当前未启用工作区工具或该工作区未获授权，因此我无法读取教学工作区文件或学习记录。你可以在设置中显式启用工具调用，并确认该工作区已授予工具访问后重试；或者直接告诉我你的目标、可用时间和当前薄弱点，我可以先据此继续。'

const WORKSPACE_REFERENCE = /(?:工作区|本地文件|教学文件|学习记录|课程文件|MISSION\.md|NOTES\.md|RESOURCES\.md|GLOSSARY\.md|learning-records|lessons|courses|reference)/iu
const WORKSPACE_READ_ACTION = /(?:查看|看看|读取|读(?:取)?|检查|浏览|列出|搜索|检索)/u
const UNFINISHED_INTENT = /(?:让我|请让我|我(?:先|现在|这就|马上|准备|会)|先|接下来(?:我)?|我们先).{0,72}(?:查看|看看|读取|读(?:取)?|检查|浏览|列出|搜索|检索)/u
const UNAVAILABLE_OR_NEGATED = /(?:无法|不能|不可|未启用|没有(?:权限|工具)|未获(?:授权|许可)|不(?:会|能|可)查看|不(?:会|能|可)读取)/u

export function replaceUnavailableWorkspaceReadPromise(
  finalText: string,
  workspaceToolsAvailable: boolean
): string | null {
  if (workspaceToolsAvailable) return null
  const text = String(finalText ?? '').trim()
  if (!text || UNAVAILABLE_OR_NEGATED.test(text)) return null
  if (!WORKSPACE_REFERENCE.test(text) || !WORKSPACE_READ_ACTION.test(text)) return null
  return UNFINISHED_INTENT.test(text) ? WORKSPACE_TOOL_UNAVAILABLE_FALLBACK : null
}
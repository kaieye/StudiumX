import type { ToolEntry, ToolContext } from './registry'
import {
  DelegationRuntime,
  type ChildAgentProfile,
  type ChildRunInput,
  type ParallelChildRunInput
} from '../delegation-runtime'
import type { TeachingModelProviderProfile } from '../../../shared/teaching-types'

export type DelegationToolOptions = {
  provider: TeachingModelProviderProfile
  streamId?: string
  signal?: AbortSignal
}

export function createDelegationToolEntries(options: DelegationToolOptions): ToolEntry[] {
  return [
    createDelegationToolEntry('delegate_task', options),
    createDelegationToolEntry('read_only_task', options, 'read_only'),
    createParallelTasksToolEntry(options)
  ]
}

function createDelegationToolEntry(
  name: 'delegate_task' | 'read_only_task',
  options: DelegationToolOptions,
  forcedProfile?: ChildAgentProfile
): ToolEntry {
  return {
    definition: {
      type: 'function',
      function: {
        name,
        description: name === 'read_only_task'
          ? '派发一个前台只读 child agent 任务，用于阅读工作区、检索网页或做窄范围调研。child 不能写文件、生成课程、询问用户或继续派发任务。'
          : '派发一个前台 child agent 任务。当前仅支持只读类 profile，适合把独立调研、代码阅读或工作区检查隔离出主上下文。',
        parameters: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: '给用户和父 agent 展示的短任务名，例如「检查现有课程规划」'
            },
            prompt: {
              type: 'string',
              description: 'child agent 要完成的具体任务。必须窄而明确。'
            },
            context: {
              type: 'string',
              description: '父 agent 已知且对任务有用的上下文；不要粘贴大型工具结果。'
            },
            profile: {
              type: 'string',
              enum: ['read_only', 'research', 'workspace_audit'],
              description: '只读任务 profile。workspace_audit 不能使用网页工具。'
            },
            maxIterations: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              description: 'child agent 的最大工具轮数，默认使用安全上限。'
            },
            timeoutMs: {
              type: 'number',
              minimum: 1000,
              maximum: 300000,
              description: 'child agent 超时时间，默认 120000ms。'
            }
          },
          required: ['label', 'prompt']
        }
      }
    },
    handler: async (args: unknown, ctx: ToolContext, callCtx) => {
      const input = normalizeDelegationArgs(args, forcedProfile)
      const runtime = new DelegationRuntime({
        settings: ctx.settings,
        provider: options.provider,
        workspaceRoot: ctx.workspaceRoot,
        parentStreamId: options.streamId,
        signal: options.signal
      })
      const result = await runtime.runChild(input, { emit: callCtx?.emit })
      return JSON.stringify(result, null, 2)
    }
  }
}

function createParallelTasksToolEntry(options: DelegationToolOptions): ToolEntry {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'parallel_tasks',
        description:
          '并发派发 1-8 个相互独立的只读 child agent 任务。适合同时阅读工作区、检索网页或做多路调研；每个 child 都不能写文件、生成课程、询问用户或继续派发任务。',
        parameters: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    description: '给用户和父 agent 展示的短任务名。'
                  },
                  prompt: {
                    type: 'string',
                    description: 'child agent 要完成的具体任务。必须窄而明确，并且和其他并行任务相互独立。'
                  },
                  context: {
                    type: 'string',
                    description: '父 agent 已知且对该任务有用的少量上下文；不要粘贴大型工具结果。'
                  },
                  profile: {
                    type: 'string',
                    enum: ['read_only', 'research', 'workspace_audit'],
                    description: '只读任务 profile。workspace_audit 不能使用网页工具。'
                  },
                  maxIterations: {
                    type: 'number',
                    minimum: 1,
                    maximum: 10,
                    description: '该 child agent 的最大工具轮数。'
                  },
                  timeoutMs: {
                    type: 'number',
                    minimum: 1000,
                    maximum: 300000,
                    description: '该 child agent 的超时时间。'
                  }
                },
                required: ['label', 'prompt']
              }
            },
            concurrency: {
              type: 'number',
              minimum: 1,
              maximum: 4,
              description: '并发槽数量，默认 3，最大 4。'
            }
          },
          required: ['tasks']
        }
      }
    },
    handler: async (args: unknown, ctx: ToolContext, callCtx) => {
      const input = normalizeParallelTasksArgs(args)
      const runtime = new DelegationRuntime({
        settings: ctx.settings,
        provider: options.provider,
        workspaceRoot: ctx.workspaceRoot,
        parentStreamId: options.streamId,
        signal: options.signal
      })
      const result = await runtime.runChildren(input, { emit: callCtx?.emit })
      return JSON.stringify(result, null, 2)
    }
  }
}

function normalizeDelegationArgs(args: unknown, forcedProfile?: ChildAgentProfile): ChildRunInput {
  const input = (args ?? {}) as Record<string, unknown>
  const label = typeof input.label === 'string' ? input.label : ''
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  const context = typeof input.context === 'string' ? input.context : undefined
  const profile = forcedProfile ?? normalizeProfile(input.profile)
  const maxIterations = typeof input.maxIterations === 'number' ? input.maxIterations : Number(input.maxIterations)
  const timeoutMs = typeof input.timeoutMs === 'number' ? input.timeoutMs : Number(input.timeoutMs)
  return {
    label,
    prompt,
    context,
    profile,
    maxIterations: Number.isFinite(maxIterations) ? maxIterations : undefined,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined
  }
}

function normalizeParallelTasksArgs(args: unknown): ParallelChildRunInput {
  const input = (args ?? {}) as Record<string, unknown>
  const tasks = Array.isArray(input.tasks)
    ? input.tasks.map((task) => normalizeDelegationArgs(task))
    : []
  const concurrency = typeof input.concurrency === 'number' ? input.concurrency : Number(input.concurrency)
  return {
    tasks,
    concurrency: Number.isFinite(concurrency) ? concurrency : undefined
  }
}

function normalizeProfile(value: unknown): ChildAgentProfile {
  return value === 'research' || value === 'workspace_audit' ? value : 'read_only'
}

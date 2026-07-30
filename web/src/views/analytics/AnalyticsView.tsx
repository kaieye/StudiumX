/**
 * Web Learning Analytics dashboard (plan §8 Phase 4, §7.1, §9.4).
 *
 * Fetches a `LearningAnalyticsBundle` via `window.teachingSystem.getLearningAnalytics`
 * (-> adapter `analytics.ts` -> GET /analytics/summary?range=) and renders a
 * focus-overview dashboard. The Web app is read-only and the server only stores
 * aggregate per-range summaries (uploaded by a desktop client; sync is DEFAULT
 * OFF - §9.4), so:
 *   - loading / error / empty states are first-class;
 *   - when no summary is stored the adapter returns an `empty` bundle and this
 *     view shows "暂无学习分析数据" - it NEVER auto-uploads derived summaries;
 *   - when a summary exists, hero + focus stats and a completion ring render;
 *   - task/token/review/memory/etc. sections are `unavailable` on Web (the
 *     server has no source data), surfaced as a scope note rather than faked.
 */

import { useCallback, useEffect, useState } from 'react'
import type {
  AnalyticsRangePreset,
  AnalyticsSectionResult,
  LearningAnalyticsBundle,
  LearningAnalyticsRequest
} from '@shared/teaching-types/analytics'
import {
  RANGE_OPTIONS,
  buildAnalyticsQuery,
  formatDuration,
  formatInstant,
  formatPercent,
  formatShortDate
} from './analytics-format'
import { CompletionRing, StatCard } from './AnalyticsCharts'

type ViewStatus = 'loading' | 'error' | 'empty' | 'ready'

/** Human message for a thrown error, without importing the http seam. AuthError
 *  is detected by its class `name` (set by the HTTP client). */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AuthError') return '登录已过期，请退出后重新登录。'
    return err.message || '加载分析数据失败。'
  }
  return '加载分析数据失败。'
}

/** Extract section `data` when the section is not unavailable/error. */
function sectionData<T>(section: AnalyticsSectionResult<T>): T | null {
  return section.state === 'unavailable' || section.state === 'error' ? null : section.data
}

export function AnalyticsView() {
  const [preset, setPreset] = useState<AnalyticsRangePreset>('week')
  const [bundle, setBundle] = useState<LearningAnalyticsBundle | null>(null)
  const [status, setStatus] = useState<ViewStatus>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  const load = useCallback(async (rangePreset: AnalyticsRangePreset) => {
    setStatus('loading')
    setErrorMsg('')
    setExportMsg(null)
    try {
      const request: LearningAnalyticsRequest = { query: buildAnalyticsQuery(rangePreset) }
      const result = await window.teachingSystem.getLearningAnalytics(request)
      setBundle(result)
      setStatus(result.hero.state === 'empty' ? 'empty' : 'ready')
    } catch (err) {
      setBundle(null)
      setStatus('error')
      setErrorMsg(describeError(err))
    }
  }, [])

  useEffect(() => {
    void load(preset)
  }, [preset, load])

  const handleExport = useCallback(async () => {
    setExporting(true)
    setExportMsg(null)
    try {
      const result = await window.teachingSystem.exportLearningAnalytics({
        query: buildAnalyticsQuery(preset),
        format: 'json',
        detail: 'summary',
        sectionIds: ['hero', 'focus']
      })
      setExportMsg(
        result.canceled
          ? '导出已取消。'
          : `已导出 ${result.fileName}（${result.bytesWritten} 字节）。`
      )
    } catch (err) {
      setExportMsg(`导出失败：${describeError(err)}`)
    } finally {
      setExporting(false)
    }
  }, [preset])

  const heroData = bundle ? sectionData(bundle.hero) : null
  const focusData = bundle ? sectionData(bundle.focus) : null
  const range = bundle?.query.range
  const focusSeconds = heroData?.focusSeconds ?? 0
  const sessions = heroData?.completedFocusSessions ?? 0
  const completionRate = focusData?.sessionStructure.completionRate ?? null
  const avgSession = focusData?.sessionStructure.averageCompletedFocusSeconds ?? null

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">学习分析</h1>
          <p className="mt-1 text-sm text-neutral-500">
            专注概览 · 数据由桌面端同步（默认关闭，plan §9.4）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.preset}
                type="button"
                onClick={() => setPreset(opt.preset)}
                className={
                  'rounded-md px-3 py-1.5 text-sm font-medium transition ' +
                  (opt.preset === preset
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100')
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load(preset)}
            disabled={status === 'loading'}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || status !== 'ready'}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50"
          >
            {exporting ? '导出中…' : '导出 JSON'}
          </button>
        </div>
      </div>

      {exportMsg ? (
        <p className="mt-3 text-sm text-neutral-500" role="status">
          {exportMsg}
        </p>
      ) : null}

      <div className="mt-6">
        {status === 'loading' ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
            <span className="text-sm text-neutral-500">正在加载分析数据…</span>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <p className="text-sm font-medium text-red-700">加载分析数据失败</p>
            <p className="mt-1 text-sm text-red-600">{errorMsg}</p>
            <button
              type="button"
              onClick={() => void load(preset)}
              className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-100"
            >
              重试
            </button>
          </div>
        ) : null}

        {status === 'empty' ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
            <p className="text-lg font-medium text-neutral-700">暂无学习分析数据</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
              学习分析同步默认关闭。如需在 Web 端查看，请在桌面端 StudiumX 启用「分析同步」并产生专注记录后重试；也可切换上方时间范围。
            </p>
          </div>
        ) : null}

        {status === 'ready' && bundle ? (
          <div className="space-y-6">
            {range ? (
              <p className="text-sm text-neutral-500">
                统计周期 {formatShortDate(range.from)} – {formatShortDate(range.to)}
                {bundle.generatedAt ? ` · 数据更新于 ${formatInstant(bundle.generatedAt)}` : ''}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="专注时长" value={formatDuration(focusSeconds)} />
              <StatCard label="完成专注会话" value={String(sessions)} />
              <StatCard label="平均会话时长" value={formatDuration(avgSession)} hint="每次完成会话" />
              <StatCard label="计划完成率" value={formatPercent(completionRate)} hint="专注 / 计划" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-neutral-700">计划完成度</h2>
                <div className="mt-2 flex justify-center">
                  <CompletionRing
                    ratio={completionRate}
                    centerValue={formatPercent(completionRate)}
                    centerLabel="计划完成率"
                    emptyLabel="暂无计划专注目标"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-neutral-700">专注概览</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">完成会话</dt>
                    <dd className="font-medium text-neutral-900">{sessions} 次</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">平均专注</dt>
                    <dd className="font-medium text-neutral-900">{formatDuration(avgSession)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">计划完成率</dt>
                    <dd className="font-medium text-neutral-900">{formatPercent(completionRate)}</dd>
                  </div>
                </dl>
                {heroData?.insightLine ? (
                  <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                    {heroData.insightLine}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs leading-relaxed text-neutral-500">
              Web 端展示专注概览（基于已同步的汇总数据）。任务、Token、复习、记忆、工作区资源等详细分析需在桌面端 StudiumX 查看，Web 端暂不支持。
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}

import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapDocumentV2 } from '../../../../shared/mindmap/domain/types'
import type { MindMapSummary } from '../../../../shared/mindmap/mind-map-types'
import { branchColor } from './mind-map-branch-colors'
import { computeMindMapLayout, type MindMapLayoutResult } from './mind-map-layout'

type MindMapHomeGalleryProps = {
  documents: readonly MindMapSummary[]
  workspaceId: string
  creating: boolean
  onCreate: () => void
  onOpenDocument: (id: string) => void | Promise<void>
}

/**
 * XMind-like home surface shown while no map is open.  The list endpoint only
 * returns summaries, so previews are loaded independently and never mutate the
 * editor's currently-open document.
 */
export function MindMapHomeGallery({
  documents,
  workspaceId,
  creating,
  onCreate,
  onOpenDocument
}: MindMapHomeGalleryProps) {
  const { t } = useTranslation()
  const [previews, setPreviews] = useState<Record<string, MindMapDocumentV2>>({})

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const entries = await Promise.all(
        documents.map(async (summary) => {
          try {
            const document = await window.teachingSystem?.readMindMap({
              workspaceId,
              id: summary.id
            })
            return document ? ([summary.id, document] as const) : null
          } catch {
            return null
          }
        })
      )
      if (cancelled) return
      const next: Record<string, MindMapDocumentV2> = {}
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1]
      }
      setPreviews(next)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [documents, workspaceId])

  return (
    <section className="mindmap-home" aria-label={t('mindmap.recentMaps')}>
      <div className="mindmap-home__header">
        <h1>{t('mindmap.recentMaps')}</h1>
      </div>
      <div className="mindmap-home__grid">
        <button
          type="button"
          className="mindmap-home-card mindmap-home-card--new"
          disabled={creating}
          onClick={onCreate}
          aria-label={t('mindmap.newDocument')}
        >
          <span className="mindmap-home-card__preview mindmap-home-card__preview--new">
            <Plus size={52} strokeWidth={1.25} aria-hidden="true" />
          </span>
          <span className="mindmap-home-card__title">{t('mindmap.newDocument')}</span>
        </button>

        {documents.map((summary) => (
          <button
            type="button"
            className="mindmap-home-card"
            key={summary.id}
            onClick={() => void onOpenDocument(summary.id)}
            aria-label={summary.title || t('mindmap.newDocument')}
          >
            <span className="mindmap-home-card__preview">
              <MindMapPreview document={previews[summary.id]} title={summary.title} />
            </span>
            <span className="mindmap-home-card__title">
              {summary.title || t('mindmap.newDocument')}
            </span>
          </button>
        ))}
      </div>
      {documents.length === 0 ? (
        <p className="mindmap-home__hint">{t('mindmap.emptyState')}</p>
      ) : null}
    </section>
  )
}

type MindMapPreviewProps = {
  document?: MindMapDocumentV2
  title: string
}

function MindMapPreview({ document, title }: MindMapPreviewProps) {
  const sheet = document?.sheets[0]
  const layout = useMemo(() => (sheet ? computeMindMapLayout(sheet) : null), [sheet])
  if (!layout || layout.nodes.length === 0) {
    return <PreviewPlaceholder title={title} />
  }
  return <PreviewSvg document={document!} layout={layout} />
}

function PreviewPlaceholder({ title }: { title: string }) {
  return (
    <svg className="mindmap-home-card__svg" viewBox="0 0 328 204" role="img" aria-label={title}>
      <rect x="103" y="78" width="122" height="48" rx="10" fill="#fff" stroke="#438eff" strokeWidth="2" />
      <text x="164" y="103" textAnchor="middle" dominantBaseline="central" fill="#2854d8" fontSize="16" fontWeight="600">
        {title || '思维导图'}
      </text>
    </svg>
  )
}

function PreviewSvg({ document, layout }: { document: MindMapDocumentV2; layout: MindMapLayoutResult }) {
  const nodes = layout.nodes
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + node.width))
  const maxY = Math.max(...nodes.map((node) => node.y + node.height))
  const padding = 28
  const viewBox = `${minX - padding} ${minY - padding} ${Math.max(180, maxX - minX + padding * 2)} ${Math.max(120, maxY - minY + padding * 2)}`

  return (
    <svg className="mindmap-home-card__svg" viewBox={viewBox} role="img" aria-label={document.title}>
      <g className="mindmap-home-card__edges">
        {layout.edges.map((edge) => {
          const from = nodeById.get(edge.from)
          const to = nodeById.get(edge.to)
          if (!from || !to) return null
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x + from.width / 2}
              y1={from.y + from.height / 2}
              x2={to.x + to.width / 2}
              y2={to.y + to.height / 2}
              stroke={branchColor(document.theme, edge.branchIndex) ?? '#6b82ee'}
              strokeWidth={Math.max(1.5, 3 - edge.branchIndex * 0.25)}
              strokeLinecap="round"
            />
          )
        })}
      </g>
      {nodes.map((node) => {
        const fill = node.depth === 1 ? branchColor(document.theme, node.branchIndex) ?? '#3157dd' : node.depth === 0 ? '#fff' : '#f5f5f7'
        const text = node.depth === 1 ? '#fff' : node.depth === 0 ? '#2854d8' : '#343434'
        return (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={Math.min(10, node.height / 2)}
              fill={fill}
              stroke={node.depth === 0 ? '#438eff' : 'none'}
              strokeWidth={node.depth === 0 ? 1.5 : 0}
            />
            <text
              x={node.x + node.width / 2}
              y={node.y + node.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill={text}
              fontSize={node.depth === 0 ? 18 : node.depth === 1 ? 12 : 9}
              fontWeight={node.depth < 2 ? 600 : 500}
            >
              {node.title || ' '}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

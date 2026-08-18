import { Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Floating zoom controls for the mind-map canvas (StudiumX-style).
 *
 * Shows zoom percentage and +/- buttons, plus fit-to-screen.
 */
type MindMapZoomControlsProps = {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
}

export function MindMapZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit
}: MindMapZoomControlsProps) {
  const { t } = useTranslation()
  const percentage = Math.round(zoom * 100)

  return (
    <div className="mindmap-zoom-controls" role="toolbar" aria-label={t('mindmap.zoomControls')}>
      <button
        type="button"
        className="mindmap-zoom-controls__btn"
        onClick={onZoomOut}
        title={t('mindmap.zoomOut')}
        aria-label={t('mindmap.zoomOut')}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="mindmap-zoom-controls__percentage"
        onClick={onFit}
        title={t('mindmap.fitCanvas')}
      >
        {percentage}%
      </button>
      <button
        type="button"
        className="mindmap-zoom-controls__btn"
        onClick={onZoomIn}
        title={t('mindmap.zoomIn')}
        aria-label={t('mindmap.zoomIn')}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}

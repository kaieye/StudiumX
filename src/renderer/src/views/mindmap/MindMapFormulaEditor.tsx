import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import { useMindMapViewStore } from './mind-map-view-store'
import { appendFormulaMarkdown } from './mind-map-topic-markdown'

type MindMapFormulaEditorProps = {
  topic: MindMapTopicV2
}

/**
 * Inline LaTeX/KaTeX formula editor for the popover's target topic.
 *
 * Shown inside the floating topic popover (see MindMapTopicPopover). Writes
 * through the canonical updateNode command path. The LaTeX draft is serialized
 * into the topic title as Markdown so the rendered formula is visible directly
 * in the node instead of being represented by an indicator icon.
 */
export function MindMapFormulaEditor({ topic: selectedTopic }: MindMapFormulaEditorProps) {
  const { t } = useTranslation()
  const updateNode = useMindMapViewStore((state) => state.updateNode)
  const [formula, setFormula] = useState(selectedTopic.formula ?? '')
  const [inline, setInline] = useState(false)
  const baseTitleRef = useRef(selectedTopic.title)

  useEffect(() => {
    baseTitleRef.current = selectedTopic.title
    setFormula(selectedTopic.formula ?? '')
  }, [selectedTopic.id])

  const updateFormula = (value: string, isInline: boolean): void => {
    setFormula(value)
    setInline(isInline)
    updateNode(selectedTopic.id, {
      title: appendFormulaMarkdown(baseTitleRef.current, value, isInline),
      formula: null
    })
  }

  return (
    <div className="mindmap-topic-content-panel__section">
      <textarea
        id="mindmap-topic-formula"
        className="mindmap-topic-content-panel__textarea"
        value={formula}
        placeholder={t('mindmap.contentPanel.formulaPlaceholder')}
        onChange={(event) => updateFormula(event.currentTarget.value, inline)}
        rows={3}
      />
      <label className="mindmap-topic-content-panel__inline-toggle">
        <input
          type="checkbox"
          checked={inline}
          onChange={() => updateFormula(formula, !inline)}
        />
        {t('mindmap.contentPanel.formulaInline')}
      </label>
    </div>
  )
}

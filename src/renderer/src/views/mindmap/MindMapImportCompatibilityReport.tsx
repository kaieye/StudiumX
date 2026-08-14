import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  XmindCompatibilityFinding,
  XmindCompatibilityReport
} from '../../../../shared/mindmap/xmind-compatibility'

export type MindMapImportCompatibilityReportProps = {
  report: XmindCompatibilityReport
  onDismiss: () => void
}

type CompatibilityCategory = keyof XmindCompatibilityReport

type CategoryDefinition = {
  key: CompatibilityCategory
  icon: typeof CheckCircle2
  tone: 'preserved' | 'approximated' | 'dropped' | 'warnings'
}

const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  { key: 'preserved', icon: CheckCircle2, tone: 'preserved' },
  { key: 'approximated', icon: Info, tone: 'approximated' },
  { key: 'dropped', icon: AlertTriangle, tone: 'dropped' },
  { key: 'warnings', icon: AlertTriangle, tone: 'warnings' }
]

/**
 * The importer keeps reasons as stable, value-free strings so the report can
 * cross the IPC boundary without a renderer-owned schema. Keep their user
 * facing copy here, and retain a localized fallback for a future reason that
 * has not yet been added to the map.
 */
const COMPATIBILITY_REASON_KEYS: Record<string, string> = {
  'Sheet collection maps to StudiumX sheets': 'sheetCollection',
  'Non-object sheet cannot be imported': 'nonObjectSheet',
  'Skipped malformed sheet entry': 'skippedMalformedSheet',
  'XMind sheet wrapper recognized': 'sheetWrapperRecognized',
  'Unsupported sheet wrapper class': 'unsupportedSheetWrapper',
  'Unknown sheet wrapper class': 'unknownSheetWrapper',
  'Stable sheet id retained': 'stableSheetId',
  'Missing or empty sheet id': 'missingSheetId',
  'Sheet without a stable id may be skipped': 'sheetIdMayBeSkipped',
  'Sheet title retained': 'sheetTitleRetained',
  'Missing title becomes an empty string': 'missingTitleEmpty',
  'Sheet title is missing or not a string': 'sheetTitleMissing',
  'Missing structure class defaults to the right layout': 'missingStructureClassDefault',
  'Supported XMind layout class retained': 'supportedLayoutRetained',
  'Unknown structure class is not representable': 'unknownStructureNotRepresentable',
  'Unknown structure class falls back to the right layout': 'unknownStructureFallback',
  'Unknown structure class': 'unknownStructureClass',
  'Missing root topic': 'missingRootTopic',
  'Sheet has no root topic': 'sheetNoRootTopic',
  'Malformed root topic': 'malformedRootTopic',
  'Root topic is not an object': 'rootTopicNotObject',
  'Root topic tree is supported': 'rootTopicSupported',
  'Relationship list is not an array': 'relationshipListNotArray',
  'Malformed relationship list': 'malformedRelationshipList',
  'Non-object relationship cannot be imported': 'nonObjectRelationship',
  'Skipped malformed relationship entry': 'skippedMalformedRelationship',
  'Unsupported relationship wrapper class': 'unsupportedRelationshipWrapper',
  'Unknown relationship wrapper class': 'unknownRelationshipWrapper',
  'Missing or empty relationship id': 'missingRelationshipId',
  'Relationship without a stable id cannot be retained': 'relationshipWithoutStableId',
  'Missing relationship start topic id': 'missingRelationshipStart',
  'Relationship start endpoint is malformed': 'malformedRelationshipStart',
  'Missing relationship end topic id': 'missingRelationshipEnd',
  'Relationship end endpoint is malformed': 'malformedRelationshipEnd',
  'Non-string relationship label is not representable': 'nonStringRelationshipLabel',
  'Relationship label has an unsupported value': 'unsupportedRelationshipLabel',
  'Sheet relationships map to StudiumX relationship elements': 'relationshipCollection',
  'Non-object topic cannot be imported': 'nonObjectTopic',
  'Skipped malformed topic entry': 'skippedMalformedTopic',
  'XMind topic wrapper recognized': 'topicWrapperRecognized',
  'Unsupported topic wrapper class': 'unsupportedTopicWrapper',
  'Unknown topic wrapper class': 'unknownTopicWrapper',
  'Stable topic id retained': 'stableTopicId',
  'Missing or empty topic id': 'missingTopicId',
  'Topic without a stable id may not be editable': 'topicIdMayNotBeEditable',
  'Topic title retained': 'topicTitleRetained',
  'Topic title is missing or not a string': 'topicTitleMissing',
  'Topic note retained': 'topicNoteRetained',
  'Non-string note is not representable': 'nonStringNote',
  'Topic note has an unsupported value': 'unsupportedTopicNote',
  'Collapsed state retained': 'collapsedStateRetained',
  'Non-boolean collapsed state is not representable': 'nonBooleanCollapsed',
  'Topic collapsed state has an unsupported value': 'unsupportedCollapsedState',
  'Supported topic layout class retained': 'supportedTopicLayoutRetained',
  'Unknown topic structure class is not representable': 'unknownTopicStructureNotRepresentable',
  'Unknown topic structure class': 'unknownTopicStructureClass',
  'Malformed children wrapper': 'malformedChildrenWrapper',
  'Topic children is not an object': 'childrenNotObject',
  'Missing attached list becomes an empty child list': 'missingAttachedList',
  'Attached children is not an array': 'attachedChildrenNotArray',
  'Malformed attached child list': 'malformedAttachedList',
  'Attached topic tree is supported': 'attachedTopicTreeSupported',
  'Field is not representable by the StudiumX mind-map model': 'unsupportedField',
  'Attachment or image was not migrated into workspace assets': 'attachmentNotMigrated',
  'Foreign extension bag was not retained at the XMind import boundary': 'extensionBagNotRetained',
  'Unsupported XMind element metadata was not migrated into StudiumX elements':
    'unsupportedElementMetadata',
  'Cyclic object is not valid JSON content': 'cyclicObject',
  'Cyclic content was not traversed': 'cyclicContentNotTraversed',
  'Expected content.json to contain a sheet array': 'contentNotSheetArray',
  'Malformed style block is not retained': 'malformedStyleBlock',
  'Malformed style list is not retained': 'malformedStyleList',
  'Malformed topic fill is not retained': 'malformedTopicFill',
  'Malformed topic border color is not retained': 'malformedTopicBorderColor',
  'Malformed topic text color is not retained': 'malformedTopicTextColor',
  'Malformed topic font family is not retained': 'malformedTopicFontFamily',
  'Malformed topic font size is not retained': 'malformedTopicFontSize',
  'Malformed topic font weight is not retained': 'malformedTopicFontWeight',
  'Malformed XMind numbering flag is not retained': 'malformedNumberingFlag',
  'Malformed XMind numbering restart index is not retained': 'malformedNumberingRestartIndex',
  'Unsupported topic font style is not retained': 'unsupportedTopicFontStyle',
  'Unsupported topic text alignment is not retained': 'unsupportedTopicTextAlign',
  'XMind border pattern has no native border-pattern mapping': 'xmindBorderPatternNoMapping',
  'XMind numbering restart index is retained': 'xmindNumberingRestartIndexRetained',
  'XMind text transform has no native topic-style mapping': 'xmindTextTransformNoMapping'
}

function findingCount(findings: readonly XmindCompatibilityFinding[]): number {
  return findings.reduce((total, finding) => {
    const count = typeof finding.count === 'number' && Number.isFinite(finding.count)
      ? Math.max(0, finding.count)
      : 0
    return total + count
  }, 0)
}

function safeFindingText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function localizedReason(
  finding: XmindCompatibilityFinding,
  translate: (key: string, options?: Record<string, unknown>) => string
): string {
  const reason = safeFindingText(finding.reason, '')
  const key = COMPATIBILITY_REASON_KEYS[reason]
  return key
    ? translate(`mindmap.importCompatibility.reasons.${key}`)
    : translate('mindmap.importCompatibility.reasonFallback', { reason })
}

/**
 * Lightweight, response-only feedback for XMind imports. The compatibility
 * report is intentionally displayed here rather than added to the canonical
 * mind-map document or persisted in the document list.
 */
export function MindMapImportCompatibilityReport({
  report,
  onDismiss
}: MindMapImportCompatibilityReportProps) {
  const { t } = useTranslation()
  const totals = {
    preserved: findingCount(report.preserved),
    approximated: findingCount(report.approximated),
    dropped: findingCount(report.dropped),
    warnings: findingCount(report.warnings)
  }
  const needsAttention = totals.dropped > 0 || totals.warnings > 0
  const hasApproximations = totals.approximated > 0
  const hasFindings = CATEGORY_DEFINITIONS.some(({ key }) => report[key].length > 0)
  const LiveIcon = needsAttention ? AlertTriangle : CheckCircle2
  const summaryKey = needsAttention
    ? 'mindmap.importCompatibility.summaryAttention'
    : hasApproximations
      ? 'mindmap.importCompatibility.summaryApproximated'
      : 'mindmap.importCompatibility.summaryComplete'

  return (
    <section
      className={`mindmap-import-compatibility is-${needsAttention ? 'attention' : 'complete'}`}
      role={needsAttention ? 'alert' : 'status'}
      aria-live={needsAttention ? 'assertive' : 'polite'}
      aria-labelledby="mindmap-import-compatibility-title"
    >
      <div className="mindmap-import-compatibility__header">
        <div className="mindmap-import-compatibility__heading">
          <LiveIcon size={14} aria-hidden="true" />
          <strong id="mindmap-import-compatibility-title">
            {t('mindmap.importCompatibility.title')}
          </strong>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onDismiss}
          aria-label={t('mindmap.importCompatibility.dismiss')}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      <p className="mindmap-import-compatibility__summary">
        {t(summaryKey)}
      </p>

      <div
        className="mindmap-import-compatibility__counts"
        aria-label={t('mindmap.importCompatibility.countsLabel')}
      >
        {CATEGORY_DEFINITIONS.map(({ key, icon: CategoryIcon, tone }) => (
          <div
            key={key}
            className={`mindmap-import-compatibility__count is-${tone}`}
            aria-label={t('mindmap.importCompatibility.categoryCount', {
              category: t(`mindmap.importCompatibility.categories.${key}`),
              count: totals[key]
            })}
          >
            <CategoryIcon size={12} aria-hidden="true" />
            <strong>
              {t('mindmap.importCompatibility.categoryCount', {
                category: t(`mindmap.importCompatibility.categories.${key}`),
                count: totals[key]
              })}
            </strong>
          </div>
        ))}
      </div>

      {hasFindings ? (
        <div className="mindmap-import-compatibility__findings">
          {CATEGORY_DEFINITIONS.map(({ key }) => {
            const findings = report[key]
            if (findings.length === 0) return null
            const count = totals[key]
            return (
              <details key={key} className="mindmap-import-compatibility__category">
                <summary>
                  <span>
                    {t('mindmap.importCompatibility.categoryCount', {
                      category: t(`mindmap.importCompatibility.categories.${key}`),
                      count
                    })}
                  </span>
                </summary>
                <ul>
                  {findings.map((finding, index) => {
                    const path = safeFindingText(finding.path, t('mindmap.importCompatibility.unknownPath'))
                    const countLabel = t('mindmap.importCompatibility.occurrences', {
                      count: findingCount([finding])
                    })
                    return (
                      <li key={`${path}-${finding.reason}-${index}`}>
                        <div className="mindmap-import-compatibility__finding-head">
                          <code>{path}</code>
                          <span>{countLabel}</span>
                        </div>
                        <p>{localizedReason(finding, t)}</p>
                      </li>
                    )
                  })}
                </ul>
              </details>
            )
          })}
        </div>
      ) : (
        <p className="mindmap-import-compatibility__empty">
          {t('mindmap.importCompatibility.noFindings')}
        </p>
      )}
    </section>
  )
}

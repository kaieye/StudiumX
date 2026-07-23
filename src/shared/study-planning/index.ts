/**
 * Study planning pure domain (Phase 1 + Phase 2 lifecycle pure module).
 *
 * ADR-0094 / ADR-0117: TimerPlanV2 + ScheduleBlock + migrate dry-run
 * (allocateTimeWindow / AllocationProposal product path removed 2026-07-22)
 * + TimerSession lifecycle pure reducers (no canonical write, no renderer wire).
 */

export {
  BUILTIN_TIMER_PLAN_CATALOG,
  TIMER_PLAN_SEED_DEFAULTS,
  createClassicPomodoroPlan,
  createContinuousCountupPlan,
  createExamSimulationPlan,
  createOpenContinuousPlan,
  createTargetContinuousPlan,
  OPEN_CONTINUOUS_SHELL,
  normalizeTimerPlanV2,
  validateTimerPlanV2,
  type BreakPolicy,
  type ContinuousMode,
  type TimerClockMode,
  type TimerPlanKind,
  type TimerPlanNotificationPolicy,
  type TimerPlanV2,
  type TimerPlanValidationIssue,
  type TimerPlanValidationResult,
  type WindowFillPolicy
} from './timer-plan'

export {
  CUSTOM_RHYTHM_SEED_LIMITS,
  CUSTOM_RHYTHM_STEP_KIND_LABELS,
  CUSTOM_RHYTHM_STEP_KIND_OPTIONS,
  advanceCustomRhythmOnPhaseComplete,
  assertBuiltinPomodoroSemanticsIntact,
  createCustomRhythmPlan,
  customRhythmMinutesForPhase,
  expandCustomRhythmSequence,
  formatCustomRhythmIssueMessage,
  isActivePlanSnapshotFrozenAgainstCatalogEdit,
  isCustomRhythmPlan,
  isSaveableCustomRhythmSequence,
  listCustomRhythmEditorIssues,
  nextCustomRhythmStep,
  normalizeCustomRhythmSequence,
  projectCustomRhythmPrimaryMinutes,
  resolveCustomRhythmStep,
  sumCustomRhythmMinutes,
  validateCustomRhythmSequence,
  type CustomRhythmStep,
  type CustomRhythmStepKind,
  type CustomRhythmValidationIssue,
  type CustomRhythmValidationResult
} from './custom-rhythm-sequence'



export {
  isValidScheduleBlockInterval,
  isValidScheduleBlockTimeZone,
  normalizeScheduleBlockTimeZoneStamp,
  proposalBlocksToScheduleBlocks,
  resolveScheduleBlockTimeZoneOnWrite,
  validateScheduleBlocks,
  type PlanningTask,
  type PlanningTaskPriority,
  type PlanningTaskStatus,
  type ScheduleBlock,
  type ScheduleBlockKind,
  type ScheduleBlockSource,
  type ScheduleBlockStatus,
  type ScheduleBlockValidationIssue
} from './schedule-block'

export {
  migrateStudyV1ToPlanning,
  v1ScheduleToIntervalMs,
  monFirstWeekdayToJs,
  jsWeekdayToMonFirst,
  monFirstScheduleToIntervalMs,
  type MigrateStudyV1Options,
  type MigrateStudyV1Result,
  type MigrationReportEntry,
  type StudySnapshotV1Slice,
  type StudyTaskV1,
  type StudyTimerPlanV1,
  type SuggestedTimeWindow
} from './migrate-v1'
export {
  applyImportMigrationCommit,
  type ImportMigrationCommitErr,
  type ImportMigrationCommitOk,
  type ImportMigrationCommitPayload
} from './import-migration-commit'

export {
  TIMER_SESSION_SEED,
  advanceTimerSession,
  assertSingleRunningTimerSession,
  findRunningTimerSessions,
  finishTimerSession,
  pauseTimerSession,
  projectTimerDisplay,
  reconcileTimerSession,
  resumeTimerSession,
  startNextPhaseFromCompleted,
  startTimerSession,
  switchTimerSessionTask,
  type ReconcileDecision,
  type StartTimerSessionInput,
  type TimerSessionAttribution,
  type TimerSessionClockMode,
  type TimerSessionLifecycleEvent,
  type TimerSessionPhase,
  type TimerSessionRecord,
  type TimerSessionReduceResult,
  type TimerSessionState
} from './timer-session-lifecycle'


export {
  computeExtendedBreakTargetSeconds,
  defaultMaxTargetSecondsForPhase,
  extendTimerSessionTarget,
  resolveExtendAddSeconds,
  type ExtendTimerSessionErr,
  type ExtendTimerSessionInput,
  type ExtendTimerSessionOk,
  type ExtendTimerSessionResult
} from './timer-session-extend'

export {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  STUDY_PLANNING_RECURRENCE_RULES_CAP,
  StudyPlanningStore,
  normalizePreferencesRecurrenceRules,
  projectTaskPlanVsActual,
  type ApplyResult,
  type StudyPlanningCommandEnvelope,
  type StudyPlanningCommandType,
  type StudyPlanningEffect,
  type StudyPlanningError,
  type StudyPlanningPreferencesV1,
  type StudyPlanningSnapshotV1
} from './study-planning-store'

export {
  BUILTIN_STUDY_PLANNING_CATEGORIES,
  STUDY_PLANNING_CATEGORY_NAME_MAX,
  STUDY_PLANNING_CUSTOM_CATEGORY_LIMIT,
  normalizeStudyPlanningCategories,
  normalizeStudyPlanningCategory,
  normalizeStudyPlanningCategoryId,
  projectCategoriesFromSnapshot,
  type StudyPlanningBuiltinCategoryId,
  type StudyPlanningCategoryId,
  type StudyPlanningCategoryV1
} from './study-planning-categories'

export {
  applyCompleteTaskFutureBlocks,
  applyDeleteTaskFutureBlocks,
  applyReopenTask,
  diffScheduleBlocks,
  projectTaskTimeline,
  type CompleteTaskWithFutureBlocksResult,
  type DeleteTaskWithFutureBlocksResult,
  type FutureBlocksDecision,
  type ProjectTaskTimelineInput,
  type ReopenTaskResult,
  type TaskTimelineItem,
  type TaskTimelineViewId
} from './task-timeline-projection'

export {
  applyClassificationAction,
  batchClassifyTasks,
  resolveEmptyStart,
  shouldShowClassificationPrompt,
  type ClassificationPromptAction,
  type ClassificationPromptDecision,
  type EmptyStartChoice,
  type EmptyStartPolicy,
  type EmptyStartResolution
} from './empty-start-and-classification'


export {
  buildDefaultQuickStartTitle,
  buildEmptyStartSheetModel,
  normalizeQuickStartTitle,
  resolvePickedTaskId,
  type EmptyStartSheetModel,
  type EmptyStartSheetOption,
  type EmptyStartSheetTask
} from './empty-start-sheet'

export {
  resolveFocusStartAttribution,
  type FocusStartAttribution,
  type ResolveFocusStartInput
} from './resolve-focus-start'

export {
  BUILTIN_TIME_WINDOW_TEMPLATES,
  TIMER_PLAN_USER_LIMIT,
  canAddTimerPlan,
  copyTimerPlanAsCustom,
  isBuiltinTimerPlanId,
  listBuiltinTimerPlans,
  materializeTimeWindowTemplate,
  projectActiveVsNextTimerPlan,
  removeTimerPlanFromCatalog,
  renameTimerPlanInCatalog,
  validateContinuousCountdownMinutes,
  type TimeWindowTemplate,
  type TimerPlanCatalogOpResult
} from './timer-plan-catalog'

export {
  detectPlanDeviations,
  projectLocalReviewStats,
  resolveNotificationChannels,
  timerStatusAriaLabel,
  type NotificationChannelDecision,
  type PlanDeviation,
  type PlanDeviationKind
} from './notification-and-review'

export {
  findScheduleConflicts,
  suggestEstimateMinutesFromHistory
} from './advanced-scheduling'

export {
  SCHEDULE_CONFLICT_RESOLVE_MAX_STEPS,
  proposeScheduleConflictResolve,
  type ProposeScheduleConflictResolveCode,
  type ProposeScheduleConflictResolveErr,
  type ProposeScheduleConflictResolveInput,
  type ProposeScheduleConflictResolveOk,
  type ProposeScheduleConflictResolvePolicy,
  type ProposeScheduleConflictResolveResult,
  type ProposeScheduleConflictResolveWindow,
  type ProposedBlockMove
} from './schedule-conflict-resolve'

export {
  expandRecurrenceToScheduleBlocks,
  mergeExpandedScheduleBlocks,
  validateRecurrenceRule,
  validateRecurrenceRules,
  type ExpandRecurrenceInput,
  type ExpandRecurrenceResult,
  type ExpandRecurrenceWarning,
  type ExpandRecurrenceWindow,
  type JsWeekday,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type RecurrenceValidationIssue
} from './recurrence'

export {
  STUDY_PLANNING_BACKUP_DIR,
  STUDY_PLANNING_DIR_SEGMENTS,
  STUDY_PLANNING_MIGRATION_REPORT_FILE,
  STUDY_PLANNING_SNAPSHOT_FILE,
  isStudyPlanningSnapshotV1,
  parseStudyPlanningSnapshotJson,
  serializeStudyPlanningSnapshot,
  studyPlanningRootRelativePath,
  studyPlanningSnapshotRelativePath
} from './snapshot-wire'

export {
  buildFutureBlocksDecisionSheetModel,
  normalizeFutureBlocksDecision,
  type FutureBlocksDecisionChoice,
  type FutureBlocksDecisionSheetModel,
  type FutureBlocksDecisionWire
} from './future-blocks-decision-sheet'

export {
  buildClassificationPromptSheetModel,
  normalizeClassificationPromptAction,
  resolveClassificationCategoryId,
  type ClassificationPromptCategory,
  type ClassificationPromptSheetModel
} from './classification-prompt-sheet'

export {
  buildBatchClassifySheetModel,
  collectInboxTaskIdsForBatchClassify,
  resolveClassificationCategoryId as resolveBatchClassifyCategoryId,
  shouldSuppressClassificationPromptStorm,
  type BatchClassifySheetModel,
  type BatchClassifySheetTask
} from './batch-classify-sheet'

export {
  buildPhasePromptSheetModel,
  breakMinutesForPhase,
  computeNextBreakPhase,
  isBreakPhase,
  normalizePhasePromptAction,
  normalizePhasePromptExtendMinutes,
  PHASE_PROMPT_EXTEND_MINUTE_OPTIONS,
  projectPhaseHandoffPlan,
  resolvePhasePromptDisposition,
  shouldOfferPhaseHandoff,
  type PhaseHandoffPlan,
  type PhasePromptAction,
  type PhasePromptSheetModel
} from './phase-prompt-sheet'

export {
  buildBreakEndPromptSheetModel,
  focusTargetSecondsForPlan,
  isWrapUpPhase,
  normalizeBreakEndPromptAction,
  projectBreakEndHandoffPlan,
  shouldOfferBreakEndHandoff,
  wrapUpMinutesForPlan,
  type BreakEndHandoffPlan,
  type BreakEndPromptAction,
  type BreakEndPromptSheetModel
} from './break-end-prompt-sheet'

export {
  buildReconcileSheetModel,
  formatReconcileGapLabel,
  gapMinutesRounded,
  normalizeReconcileSheetAction,
  reconcileDecisionFromAction,
  shouldOfferReconcileSheet,
  type ReconcileSheetAction,
  type ReconcileSheetModel
} from './reconcile-sheet'

export {
  absoluteDurationMs,
  EDITABLE_RANGE_MIN_MINUTES_DEFAULT,
  formatZonedRangeDisplay,
  getUtcOffsetMinutes,
  nextLocalMidnightMs,
  projectWallClock,
  reprojectIntervalWallPreserve,
  reprojectWallClockLabels,
  resolveLocalDateTime,
  splitIntervalAtLocalMidnights,
  splitScheduleRangeAcrossMidnight,
  validateEditableTimeRange,
  type DateBlockSlice,
  type EditableRangeIssue,
  type EditableRangeValidation,
  type LocalDateTimeInput,
  type LocalTimeResolution,
  type ReprojectWallClockResult,
  type SplitIntervalResult,
  type TimeZoneId,
  type WallClockParts,
  type WallPreserveRezoneResult
} from './timezone-dst-editing'

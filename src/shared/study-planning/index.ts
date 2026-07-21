/**
 * Study planning pure domain (Phase 1 + Phase 2 lifecycle pure module).
 *
 * ADR-0094 §4 / ADR-0117: TimerPlanV2 + allocateTimeWindow + ScheduleBlock + migrate dry-run
 * + TimerSession lifecycle pure reducers (no canonical write, no renderer wire).
 */

export {
  BUILTIN_TIMER_PLAN_CATALOG,
  TIMER_PLAN_SEED_DEFAULTS,
  createClassicPomodoroPlan,
  normalizeTimerPlanV2,
  validateTimerPlanV2,
  type BreakPolicy,
  type TimerClockMode,
  type TimerPlanKind,
  type TimerPlanNotificationPolicy,
  type TimerPlanV2,
  type TimerPlanValidationIssue,
  type TimerPlanValidationResult,
  type WindowFillPolicy
} from './timer-plan'

export {
  ALLOCATOR_TEST_DAY_UTC,
  allocateTimeWindow,
  msFromLocalMinutes,
  type AllocateTimeWindowInput,
  type AllocationProposal,
  type AllocatorTask,
  type LockedScheduleBlock,
  type ProposedBlock,
  type ProposedBlockKind,
  type TimeWindow
} from './allocate-time-window'

export {
  isValidScheduleBlockInterval,
  proposalBlocksToScheduleBlocks,
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
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  StudyPlanningStore,
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
  applyCompleteTaskFutureBlocks,
  diffScheduleBlocks,
  projectTaskTimeline,
  type CompleteTaskWithFutureBlocksResult,
  type FutureBlocksDecision,
  type ProjectTaskTimelineInput,
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
  allocateMultiWindowDay,
  compareAllocationUtilization,
  findScheduleConflicts,
  suggestEstimateMinutesFromHistory,
  type UtilizationCompareRow
} from './advanced-scheduling'

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


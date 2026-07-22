import {
  ArrowUpRight,
  Bell,
  FileCheck2,
  FileText,
  FolderOpen,
  Info,
  Loader2,
  Minus,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  Upload,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CreateTeachingMemoryPayload,
  type ConnectorStatus,
  type ConnectorStatusesResult,
  type ListUpstreamModelsResult,
  type ProbeProviderPayload,
  type ProbeProviderResult,
  type RemoveTeachingGitWorktreePayload,
  type SettingsSection,
  type TeachingGitWorktreesResult,
  type TeachingMemoryDiagnostics,
  type TeachingMemoryRecord,
  type TeachingMemoryScope,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type TeachingWorkspaceSummary,
  type UpdateTeachingMemoryPayload,
  type WebSearchBackend,
  type AgentApprovalMode
} from '../../../../shared/teaching-types'
import {
  parallelSearchModeOptions,
  runtimeProviderLabel,
  settingsNavItems,
  toolsSupportedForSettings,
  webSearchBackendLabel,
  webSearchBackendOptions,
  agentApprovalModeOptions
} from '../../workflows/settings'
import {
  NumberInput,
  SegmentedControl,
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSelect,
  SettingsTextInput,
  ToggleSwitch
} from './SettingsPrimitives'
import { useTeachingWorkspaceConfiguration } from '../../workflows/teaching-workspace-configuration'
import { ModelProviderSettingsSection } from './sections/ModelProviderSettingsSection'
import { TeachingDoctorSettingsSection } from './sections/TeachingDoctorSettingsSection'
import { TeachingTurnReviewSettingsSection } from './sections/TeachingTurnReviewSettingsSection'

export function SettingsView({
  section,
  settings,
  activeWorkspace,
  onClose,
  onSectionChange,
  onUpdateSettings,
  onPickDefaultRoot,
  onCreateWorkspace,
  onImportWorkspace,
  onOpenPath,
  onOpenExternal,
  onTestNotification,
  onProbeProvider,
  onListUpstreamModels,
  onListGitWorktrees,
  onRemoveGitWorktree,
  memoryRecords,
  memoryDiagnostics,
  onListMemory,
  onCreateMemory,
  onUpdateMemory,
  onDeleteMemory,
  onLoadMemoryDiagnostics,
  onOpenLogFile,
  onOpenAppDataDir
}: {
  section: SettingsSection
  settings: TeachingSettingsV1
  activeWorkspace: TeachingWorkspaceSummary | null
  onClose: () => void
  onSectionChange: (section: SettingsSection) => void
  onUpdateSettings: (patch: TeachingSettingsPatch) => Promise<void>
  onPickDefaultRoot: () => Promise<void>
  onCreateWorkspace: () => Promise<void>
  onImportWorkspace: () => Promise<boolean>
  onOpenPath: (path: string) => Promise<void>
  onOpenExternal: (url: string) => Promise<void>
  onTestNotification: () => Promise<void>
  onProbeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  onListUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  onListGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  onRemoveGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<void>
  memoryRecords: TeachingMemoryRecord[]
  memoryDiagnostics: TeachingMemoryDiagnostics | null
  onListMemory: (workspaceRoot?: string) => Promise<void>
  onCreateMemory: (payload: CreateTeachingMemoryPayload) => Promise<boolean>
  onUpdateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<boolean>
  onDeleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  onLoadMemoryDiagnostics: () => Promise<void>
  onOpenLogFile: () => Promise<void>
  onOpenAppDataDir: () => Promise<void>
}) {
  const { t } = useTranslation()
  const worktreeRootPath = settings.worktree?.rootPath ?? ''
  const configuration = useTeachingWorkspaceConfiguration({
    section,
    settings,
    activeWorkspace,
    adapter: {
      updateSettings: onUpdateSettings,
      probeProvider: onProbeProvider,
      listUpstreamModels: onListUpstreamModels,
      listGitWorktrees: onListGitWorktrees,
      removeGitWorktree: onRemoveGitWorktree,
      listMemory: onListMemory,
      createMemory: onCreateMemory,
      updateMemory: onUpdateMemory,
      deleteMemory: onDeleteMemory,
      loadMemoryDiagnostics: onLoadMemoryDiagnostics
    }
  })
  const { worktrees, memory } = configuration.state
  const worktreeResult = worktrees.result
  const worktreeBusyPath = worktrees.busyPath
  const worktreeLoading = worktrees.loading
  const filteredMemoryRecords = configuration.filterMemoryRecords(memoryRecords)
  const [connectorStatuses, setConnectorStatuses] = useState<ConnectorStatusesResult | null>(null)
  const [connectorStatusesLoading, setConnectorStatusesLoading] = useState(false)

  const refreshConnectorStatuses = async (): Promise<void> => {
    const api = window.teachingSystem
    if (!api) return
    setConnectorStatusesLoading(true)
    try {
      setConnectorStatuses(await api.getConnectorStatuses())
    } finally {
      setConnectorStatusesLoading(false)
    }
  }

  useEffect(() => {
    if (section !== 'connectors') return
    void refreshConnectorStatuses()
  }, [
    section,
    activeWorkspace?.id,
    settings.tools.enabled,
    settings.tools.workspaceRead,
    settings.tools.webSearch,
    settings.tools.webFetch,
    settings.webSearch.backend,
    settings.webSearch.firecrawlApiKey,
    settings.webSearch.firecrawlApiUrl,
    settings.webSearch.parallelApiKey,
    settings.webSearch.tavilyApiKey,
    settings.webSearch.exaApiKey,
    settings.webSearch.searxngUrl,
    settings.webSearch.braveApiKey,
    settings.webSearch.xaiApiKey
  ])

  return (
    <div className="settings-floating-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="settings-view" aria-label={t('settings.aria')} role="dialog" aria-modal="true">
        <button className="settings-close-button" type="button" aria-label={t('settings.close')} onClick={onClose}>
          <X size={17} />
        </button>
        <aside className="settings-nav" aria-label={t('settings.navAria')}>
        <div className="settings-nav-heading">{t('settings.navHeading')}</div>
        {settingsNavItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`settings-nav-item ${section === item.id ? 'is-active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
            >
              <Icon size={17} />
              <span>
                <strong>{t(`settingsSection.${item.id}.label`)}</strong>
                <small>{t(`settingsSection.${item.id}.detail`)}</small>
              </span>
            </button>
          )
        })}
      </aside>

      <div className="settings-content">
        {section === 'general' && (
          <SettingsPanel
            title={t('general.title')}
            subtitle={t('general.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('general.closeAction.label')} detail={settings.appBehavior.closeAction === 'tray' ? t('general.closeAction.detailTray') : t('general.closeAction.detailQuit')}>
                <SegmentedControl
                  value={settings.appBehavior.closeAction}
                  options={[
                    { value: 'quit', label: t('general.closeAction.quit') },
                    { value: 'tray', label: t('general.closeAction.tray') }
                  ]}
                  onChange={(closeAction) => void configuration.updateSetting('appBehavior.closeAction', closeAction)}
                />
              </SettingsRow>
              <SettingsRow label={t('general.openAtLogin.label')} detail={t('general.openAtLogin.detail')}>
                <ToggleSwitch
                  checked={settings.appBehavior.openAtLogin}
                  onChange={(openAtLogin) => void configuration.updateSetting('appBehavior.openAtLogin', openAtLogin)}
                />
              </SettingsRow>
              <SettingsRow label={t('general.startMinimized.label')} detail={t('general.startMinimized.detail')}>
                <ToggleSwitch
                  checked={settings.appBehavior.startMinimized}
                  onChange={(startMinimized) => void configuration.updateSetting('appBehavior.startMinimized', startMinimized)}
                />
              </SettingsRow>
              <SettingsRow label={t('general.log.label')} detail={t('general.log.detail', { state: settings.log.enabled ? t('general.log.enabled') : t('general.log.disabled'), days: settings.log.retentionDays })}>
                <div className="settings-inline-group">
                  <ToggleSwitch
                    checked={settings.log.enabled}
                    onChange={(enabled) => void configuration.updateSetting('log.enabled', enabled)}
                  />
                  <NumberInput
                    max={90}
                    min={1}
                    step={1}
                    value={settings.log.retentionDays}
                    onChange={(retentionDays) => void configuration.updateSetting('log.retentionDays', retentionDays)}
                  />
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'appearance' && (
          <SettingsPanel
            title={t('appearance.title')}
            subtitle={t('appearance.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('general.theme.label')} detail={t('general.theme.detail')}>
                <SettingsSelect
                  value={settings.theme}
                  position="item-aligned"
                  options={[
                    { value: 'system', label: t('general.theme.system'), icon: Monitor },
                    { value: 'light', label: t('general.theme.light'), icon: Sun },
                    { value: 'dark', label: t('general.theme.dark'), icon: Moon }
                  ]}
                  onChange={(theme) => void configuration.updateSetting('theme', theme)}
                />
              </SettingsRow>
              <SettingsRow label={t('general.density.label')} detail={settings.density === 'compact' ? t('general.density.compact') : t('general.density.comfortable')}>
                <SegmentedControl
                  value={settings.density}
                  options={[
                    { value: 'comfortable', label: t('general.density.comfortable') },
                    { value: 'compact', label: t('general.density.compact') }
                  ]}
                  onChange={(density) => void configuration.updateSetting('density', density)}
                />
              </SettingsRow>
              <SettingsRow label={t('general.fontScale.label')} detail={`${Math.round(settings.uiFontScale * 100)}%`}>
                <input
                  className="settings-range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  type="range"
                  value={settings.uiFontScale}
                  onChange={(event) => void configuration.updateSetting('uiFontScale', Number(event.target.value))}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'model' && (
          <ModelProviderSettingsSection
            settings={settings}
            configuration={configuration}
            onOpenExternal={onOpenExternal}
          />
        )}

        {section === 'generation' && (
          <SettingsPanel
            title={t('generation.title')}
            subtitle={t('generation.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('generation.duration.label')} detail={t('generation.duration.detail', { count: settings.generator.lessonDurationMinutes })}>
                <NumberInput
                  max={60}
                  min={5}
                  step={1}
                  value={settings.generator.lessonDurationMinutes}
                  onChange={(lessonDurationMinutes) => void configuration.updateSetting('generator.lessonDurationMinutes', lessonDurationMinutes)}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.retrieval.label')} detail={t('generation.retrieval.detail')}>
                <ToggleSwitch
                  checked={settings.generator.includeRetrievalPractice}
                  onChange={(includeRetrievalPractice) => void configuration.updateSetting('generator.includeRetrievalPractice', includeRetrievalPractice)}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.reference.label')} detail={t('generation.reference.detail')}>
                <ToggleSwitch
                  checked={settings.generator.generateReference}
                  onChange={(generateReference) => void configuration.updateSetting('generator.generateReference', generateReference)}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.structured.label')} detail={t('generation.structured.detail')}>
                <ToggleSwitch
                  checked={settings.generator.structuredOutput}
                  onChange={(structuredOutput) => void configuration.updateSetting('generator.structuredOutput', structuredOutput)}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.streaming.label')} detail={t('generation.streaming.detail')}>
                <ToggleSwitch
                  checked={settings.generator.streaming}
                  onChange={(streaming) => void configuration.updateSetting('generator.streaming', streaming)}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'tools' && (
          <SettingsPanel
            title="工具调用"
            subtitle="允许 Agent 与课程生成调用 web 搜索等工具"
          >
            <SettingsCard>
              <SettingsRow label="启用工具调用" detail="开启后 Agent 与课程生成可调用工具">
                <ToggleSwitch
                  checked={settings.tools.enabled}
                  onChange={(enabled) => void configuration.updateSetting('tools.enabled', enabled)}
                />
              </SettingsRow>
              <SettingsRow label="工作区文件工具" detail="允许 Agent 列出、读取、搜索、写入当前教学工作区文件">
                <ToggleSwitch
                  checked={settings.tools.workspaceRead}
                  onChange={(workspaceRead) => void configuration.updateSetting('tools.workspaceRead', workspaceRead)}
                />
              </SettingsRow>
              <SettingsRow label="Agent 权限模式" detail="与对话框左下角保持一致：统一控制 Agent 对工作区文件执行写入操作时的审批策略">
                <SettingsSelect
                  value={settings.tools.approvalMode}
                  options={agentApprovalModeOptions}
                  onChange={(approvalMode: AgentApprovalMode) =>
                    void configuration.updateSetting('tools.approvalMode', approvalMode)}
                />
              </SettingsRow>
              <SettingsRow label="web_search（多后端）" detail="自动使用 SearXNG、Brave Search 或 DuckDuckGo Lite 检索最新和课程外信息">
                <ToggleSwitch
                  checked={settings.tools.webSearch}
                  onChange={(webSearch) => void configuration.updateSetting('tools.webSearch', webSearch)}
                />
              </SettingsRow>
              <SettingsRow label="web_fetch" detail="抓取指定 URL 正文（带 SSRF 防护）">
                <ToggleSwitch
                  checked={settings.tools.webFetch}
                  onChange={(webFetch) => void configuration.updateSetting('tools.webFetch', webFetch)}
                />
              </SettingsRow>
              <SettingsRow label="最大工具调用轮数" detail="默认 0（不限轮数），仍受时长、模型调用、工具调用和 Token 运行预算保护">
                <NumberInput
                  max={64}
                  min={0}
                  step={1}
                  value={settings.tools.maxIterations}
                  onChange={(maxIterations) => void configuration.updateSetting('tools.maxIterations', maxIterations)}
                />
              </SettingsRow>
              <SettingsRow label="端点格式支持" detail={
                toolsSupportedForSettings(settings)
                  ? `当前「${settings.generator.endpointFormat}」支持工具调用`
                  : `当前「${settings.generator.endpointFormat}」不支持工具调用，将降级为纯文本`
              }>
                <span style={{ fontSize: 13, color: '#68778f' }}>
                  {settings.generator.endpointFormat}
                </span>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'search' && (
          <SettingsPanel
            title="搜索配置"
            subtitle="选择 web_search 的后端，并配置 Firecrawl、Parallel、Tavily、Exa、SearXNG、Brave、DDGS 或 xAI。"
          >
            <SettingsCard>
              <SettingsRow label="搜索后端" detail={`当前：${webSearchBackendLabel(settings.webSearch.backend)}`}>
                <SettingsSelect<WebSearchBackend>
                  value={settings.webSearch.backend}
                  options={webSearchBackendOptions}
                  onChange={(backend) => void configuration.updateSetting('webSearch.backend', backend)}
                />
              </SettingsRow>
              <SettingsRow label="失败自动回退" detail="Auto 模式下某个后端失败或返回空结果时继续尝试下一个。">
                <ToggleSwitch
                  checked={settings.webSearch.fallbackEnabled}
                  onChange={(fallbackEnabled) => void configuration.updateSetting('webSearch.fallbackEnabled', fallbackEnabled)}
                />
              </SettingsRow>
              <SettingsRow label="默认结果数" detail={`${settings.webSearch.maxResults} 条`}>
                <NumberInput
                  max={20}
                  min={1}
                  step={1}
                  value={settings.webSearch.maxResults}
                  onChange={(maxResults) => void configuration.updateSetting('webSearch.maxResults', maxResults)}
                />
              </SettingsRow>
            </SettingsCard>

            <SettingsCard>
              <SettingsRow label="Firecrawl API Key" detail="用于 Firecrawl 云端搜索。自托管实例可只填 API URL。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.firecrawlApiKey}
                  placeholder="fc-..."
                  onChange={(firecrawlApiKey) => void configuration.updateSetting('webSearch.firecrawlApiKey', firecrawlApiKey)}
                />
              </SettingsRow>
              <SettingsRow label="Firecrawl API URL" detail="留空使用 https://api.firecrawl.dev；自托管时填写实例地址。">
                <SettingsTextInput
                  value={settings.webSearch.firecrawlApiUrl}
                  placeholder="http://localhost:3002"
                  onChange={(firecrawlApiUrl) => void configuration.updateSetting('webSearch.firecrawlApiUrl', firecrawlApiUrl)}
                />
              </SettingsRow>
              <SettingsRow label="Parallel API Key" detail="agentic 会映射到 pro processor；fast / one-shot 映射到 base。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.parallelApiKey}
                  placeholder="Parallel API Key"
                  onChange={(parallelApiKey) => void configuration.updateSetting('webSearch.parallelApiKey', parallelApiKey)}
                />
              </SettingsRow>
              <SettingsRow label="Parallel 搜索模式" detail={settings.webSearch.parallelSearchMode}>
                <SettingsSelect
                  value={settings.webSearch.parallelSearchMode}
                  options={parallelSearchModeOptions}
                  onChange={(parallelSearchMode) => void configuration.updateSetting('webSearch.parallelSearchMode', parallelSearchMode)}
                />
              </SettingsRow>
              <SettingsRow label="Tavily API Key" detail="用于 Tavily Search API。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.tavilyApiKey}
                  placeholder="tvly-..."
                  onChange={(tavilyApiKey) => void configuration.updateSetting('webSearch.tavilyApiKey', tavilyApiKey)}
                />
              </SettingsRow>
              <SettingsRow label="Exa API Key" detail="用于 Exa 语义搜索。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.exaApiKey}
                  placeholder="Exa API Key"
                  onChange={(exaApiKey) => void configuration.updateSetting('webSearch.exaApiKey', exaApiKey)}
                />
              </SettingsRow>
              <SettingsRow label="SearXNG URL" detail="自托管或可信实例地址；需要启用 JSON format。">
                <SettingsTextInput
                  value={settings.webSearch.searxngUrl}
                  placeholder="http://localhost:8888"
                  onChange={(searxngUrl) => void configuration.updateSetting('webSearch.searxngUrl', searxngUrl)}
                />
              </SettingsRow>
              <SettingsRow label="Brave Search API Key" detail="Brave Search Data API。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.braveApiKey}
                  placeholder="Brave Search API Key"
                  onChange={(braveApiKey) => void configuration.updateSetting('webSearch.braveApiKey', braveApiKey)}
                />
              </SettingsRow>
              <SettingsRow label="xAI API Key" detail="显式选择 xAI 后通过 Grok server-side web_search 搜索。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.xaiApiKey}
                  placeholder="xai-..."
                  onChange={(xaiApiKey) => void configuration.updateSetting('webSearch.xaiApiKey', xaiApiKey)}
                />
              </SettingsRow>
              <SettingsRow label="xAI 模型" detail="用于 Responses API 的 Grok 模型。">
                <SettingsTextInput
                  value={settings.webSearch.xaiModel}
                  placeholder="grok-4.3"
                  onChange={(xaiModel) => void configuration.updateSetting('webSearch.xaiModel', xaiModel)}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'connectors' && (
          <SettingsPanel
            title={t('connectors.title')}
            subtitle={t('connectors.subtitle')}
          >
            <SettingsCard>
              <div className="settings-toolbar">
                <span className="settings-connector-refresh-copy">
                  {connectorStatuses
                    ? t('connectors.generatedAt', { time: new Date(connectorStatuses.generatedAt).toLocaleString() })
                    : t('connectors.notLoaded')}
                </span>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void refreshConnectorStatuses()}
                  disabled={connectorStatusesLoading}
                >
                  <RefreshCw size={15} className={connectorStatusesLoading ? 'spin' : undefined} />
                  {t('connectors.refresh')}
                </button>
              </div>
              {connectorStatuses?.connectors.length ? (
                connectorStatuses.connectors.map((connector) => (
                  <ConnectorStatusRow key={connector.id} connector={connector} />
                ))
              ) : (
                <div className="settings-empty-note">
                  {connectorStatusesLoading ? t('connectors.loading') : t('connectors.empty')}
                </div>
              )}
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'workspace' && (
          <SettingsPanel
            title={t('workspace.title')}
            subtitle={t('workspace.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('workspace.defaultRoot.label')} detail={settings.workspace.defaultRoot || t('workspace.defaultRoot.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onPickDefaultRoot()}>
                    <FolderOpen size={15} />
                    {t('workspace.defaultRoot.choose')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void onOpenPath(settings.workspace.defaultRoot)} disabled={!settings.workspace.defaultRoot}>
                    <ArrowUpRight size={15} />
                    {t('workspace.defaultRoot.open')}
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow label={t('workspace.confirm.label')} detail={t('workspace.confirm.detail')}>
                <ToggleSwitch
                  checked={settings.workspace.confirmBeforeGenerating}
                  onChange={(confirmBeforeGenerating) => void configuration.updateSetting('workspace.confirmBeforeGenerating', confirmBeforeGenerating)}
                />
              </SettingsRow>
              <SettingsRow label={t('workspace.autoOpen.label')} detail={t('workspace.autoOpen.detail')}>
                <ToggleSwitch
                  checked={settings.workspace.autoOpenGeneratedLesson}
                  onChange={(autoOpenGeneratedLesson) => void configuration.updateSetting('workspace.autoOpenGeneratedLesson', autoOpenGeneratedLesson)}
                />
              </SettingsRow>
              <SettingsRow label={t('workspace.showAllCourseFiles.label')} detail={t('workspace.showAllCourseFiles.detail')}>
                <ToggleSwitch
                  checked={settings.workspace.showAllCourseFiles}
                  onChange={(showAllCourseFiles) => void configuration.updateSetting('workspace.showAllCourseFiles', showAllCourseFiles)}
                />
              </SettingsRow>
              <SettingsRow label={t('workspace.current.label')} detail={activeWorkspace?.rootPath ?? t('workspace.current.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onCreateWorkspace()}>
                    <Plus size={15} />
                    {t('workspace.current.create')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void onImportWorkspace()}>
                    <Upload size={15} />
                    {t('workspace.current.import')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => activeWorkspace && void onOpenPath(activeWorkspace.rootPath)} disabled={!activeWorkspace}>
                    <ArrowUpRight size={15} />
                    {t('workspace.current.open')}
                  </button>
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'worktree' && (
          <SettingsPanel
            title={t('worktree.title')}
            subtitle={t('worktree.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('worktree.root.label')} detail={worktreeRootPath || t('worktree.root.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onOpenPath(worktreeRootPath)} disabled={!worktreeRootPath}>
                    <ArrowUpRight size={15} />
                    {t('worktree.root.open')}
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow label={t('worktree.current.label')} detail={activeWorkspace?.git?.repositoryRoot ?? t('worktree.current.none')}>
                <div className="settings-inline-group">
                  <span className="settings-status-badge">
                    {activeWorkspace?.git?.currentBranch ?? t('worktree.current.notGit')}
                  </span>
                  <button className="ghost-button" type="button" onClick={() => void configuration.refreshWorktrees()} disabled={!activeWorkspace || worktreeLoading}>
                    {worktreeLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                    {t('worktree.refresh')}
                  </button>
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard>
              {worktreeResult?.ok === false ? (
                <div className="settings-empty-note">{worktreeResult.message}</div>
              ) : !worktreeResult?.ok || worktreeResult.worktrees.length === 0 ? (
                <div className="settings-empty-note">{t('worktree.empty')}</div>
              ) : (
                worktreeResult.worktrees.map((worktree) => (
                  <div className="settings-list-row" key={worktree.path}>
                    <div className="settings-list-copy">
                      <strong>{worktree.branch ?? t('worktree.detached')}</strong>
                      <span>{worktree.path}</span>
                      <span>
                        {worktree.isPrimary ? t('worktree.primary') : t('worktree.linked')}
                        {worktree.createdAt ? ` · ${new Date(worktree.createdAt).toLocaleString(settings.locale)}` : ''}
                      </span>
                    </div>
                    <div className="settings-row-control">
                      <button
                        className="ghost-button danger"
                        type="button"
                        disabled={worktree.isPrimary || worktreeBusyPath === worktree.path}
                        onClick={() => void configuration.removeWorktree(worktree.path)}
                      >
                        {worktreeBusyPath === worktree.path ? <Loader2 className="spin" size={15} /> : <X size={15} />}
                        {t('worktree.remove')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'memory' && (
          <SettingsPanel
            title={t('memory.title')}
            subtitle={t('memory.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('memory.enable.label')} detail={t('memory.enable.detail')}>
                <ToggleSwitch
                  checked={settings.memory.enabled}
                  onChange={(enabled) => void configuration.updateSetting('memory.enabled', enabled)}
                />
              </SettingsRow>
              <SettingsRow label={t('memory.maxInjected.label')} detail={t('memory.maxInjected.detail', { count: settings.memory.maxInjected })}>
                <NumberInput
                  min={1}
                  max={12}
                  step={1}
                  value={settings.memory.maxInjected}
                  onChange={(maxInjected) => void configuration.updateSetting('memory.maxInjected', maxInjected)}
                />
              </SettingsRow>
              <SettingsRow label={t('memory.diagnostics.label')} detail={memoryDiagnostics ? t('memory.diagnostics.detail', { active: memoryDiagnostics.activeCount, deleted: memoryDiagnostics.tombstoneCount }) : t('memory.diagnostics.loading')}>
                <button className="ghost-button" type="button" onClick={() => void configuration.refreshMemory()}>
                  <RefreshCw size={15} />
                  {t('memory.refresh')}
                </button>
              </SettingsRow>
              {memoryDiagnostics && (
                <SettingsRow
                  label={t('memory.diagnostics.migrationPreflightLabel')}
                  detail={t('memory.diagnostics.migrationPreflight', {
                    eligible: memoryDiagnostics.legacyMigrationPreflight.legacyFlatEligibleCount,
                    partitioned: memoryDiagnostics.legacyMigrationPreflight.alreadyPartitionedCount,
                    duplicates: memoryDiagnostics.legacyMigrationPreflight.blockedDuplicateCount,
                    recovery: memoryDiagnostics.legacyMigrationPreflight.blockedRecoveryIssueCount
                  })}
                >
                  <span className="settings-status-badge">{memoryDiagnostics.legacyMigrationPreflight.migrationReady ? t('memory.diagnostics.migrationReady') : t('memory.diagnostics.migrationBlocked')}</span>
                </SettingsRow>
              )}
            </SettingsCard>

            <SettingsCard>
              <div className="settings-toolbar">
                <div className="settings-filter-group">
                  {(['all', 'user', 'workspace', 'project'] as const).map((scope) => (
                    <button
                      key={scope}
                      className={memory.scopeFilter === scope ? 'is-active' : ''}
                      type="button"
                      onClick={() => configuration.setMemoryScopeFilter(scope)}
                    >
                      {t(`memory.scope.${scope}`)}
                    </button>
                  ))}
                </div>
                <button className="ghost-button strong" type="button" onClick={configuration.beginCreateMemory}>
                  <Plus size={15} />
                  {t('memory.create')}
                </button>
              </div>

              {filteredMemoryRecords.length === 0 ? (
                <div className="settings-empty-note">{t('memory.empty')}</div>
              ) : (
                filteredMemoryRecords.map((memory) => (
                  <div className="settings-list-row" key={memory.id}>
                    <div className="settings-list-copy">
                      <strong>{memory.content}</strong>
                      <span>{[memory.scope, ...(memory.tags ?? [])].join(' · ')}</span>
                      <span>{memory.disabledAt ? t('memory.disabled') : t('memory.confidence', { value: memory.confidence.toFixed(2) })}</span>
                    </div>
                    <div className="settings-row-control">
                      <div className="settings-actions">
                        <button className="ghost-button" type="button" onClick={() => configuration.viewMemory(memory)}>
                          <Info size={15} />
                          {t('memory.view')}
                        </button>
                        <button className="ghost-button" type="button" onClick={() => configuration.beginEditMemory(memory)}>
                          <FileCheck2 size={15} />
                          {t('memory.edit')}
                        </button>
                        <button className="ghost-button" type="button" disabled={Boolean(memory.disabledAt)} onClick={() => void configuration.disableMemory(memory.id)}>
                          <Minus size={15} />
                          {t('memory.disable')}
                        </button>
                        <button className="ghost-button danger" type="button" onClick={() => void configuration.deleteMemory(memory.id)}>
                          <X size={15} />
                          {t('memory.delete')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </SettingsCard>

            {memory.dialog && (
              <MemoryDialog
                dialog={memory.dialog}
                draft={memory.draft}
                locale={settings.locale}
                onChange={configuration.setMemoryDraft}
                onClose={configuration.closeMemoryDialog}
                onSave={() => void configuration.saveMemoryDraft()}
                t={t}
              />
            )}
          </SettingsPanel>
        )}

        {section === 'notifications' && (
          <SettingsPanel
            title={t('notifications.title')}
            subtitle={t('notifications.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('notifications.enabled.label')} detail={settings.notifications.enabled ? t('notifications.enabled.on') : t('notifications.enabled.off')}>
                <ToggleSwitch
                  checked={settings.notifications.enabled}
                  onChange={(enabled) => void configuration.updateSetting('notifications.enabled', enabled)}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.lesson.label')} detail={t('notifications.lesson.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.lessonGenerated}
                  onChange={(lessonGenerated) => void configuration.updateSetting('notifications.lessonGenerated', lessonGenerated)}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.imported.label')} detail={t('notifications.imported.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.workspaceImported}
                  onChange={(workspaceImported) => void configuration.updateSetting('notifications.workspaceImported', workspaceImported)}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.errors.label')} detail={t('notifications.errors.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.errors}
                  onChange={(errors) => void configuration.updateSetting('notifications.errors', errors)}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.test.label')} detail={t('notifications.test.detail')}>
                <button className="ghost-button" type="button" onClick={() => void onTestNotification()}>
                  <Bell size={15} />
                  {t('notifications.test.button')}
                </button>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'privacy' && (
          <SettingsPanel
            title={t('privacy.title')}
            subtitle={t('privacy.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('privacy.maskKey.label')} detail={t('privacy.maskKey.detail')}>
                <ToggleSwitch
                  checked={settings.privacy.maskApiKeys}
                  onChange={(maskApiKeys) => void configuration.updateSetting('privacy.maskApiKeys', maskApiKeys)}
                />
              </SettingsRow>
              <SettingsRow label={t('privacy.externalLinks.label')} detail={t('privacy.externalLinks.detail')}>
                <ToggleSwitch
                  checked={settings.privacy.allowExternalLinks}
                  onChange={(allowExternalLinks) => void configuration.updateSetting('privacy.allowExternalLinks', allowExternalLinks)}
                />
              </SettingsRow>
              <SettingsRow label={t('privacy.proxy.label')} detail={settings.provider.proxy.enabled ? (settings.provider.proxy.url || t('privacy.proxy.on')) : t('privacy.proxy.off')}>
                <div className="settings-inline-group">
                  <ToggleSwitch
                    checked={settings.provider.proxy.enabled}
                    onChange={(enabled) => void configuration.updateSetting('provider.proxy.enabled', enabled)}
                  />
                  <SettingsTextInput
                    value={settings.provider.proxy.url}
                    placeholder={t('privacy.proxy.placeholder')}
                    onChange={(url) => void configuration.updateSetting('provider.proxy.url', url)}
                  />
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'review' && (
          <TeachingTurnReviewSettingsSection />
        )}

        {section === 'doctor' && <TeachingDoctorSettingsSection />}

        {section === 'about' && (
          <SettingsPanel
            title={t('about.title')}
            subtitle={t('about.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('about.runtime')} detail={runtimeProviderLabel(settings)}>
                <span className="settings-status-badge">{settings.generator.streaming ? t('about.streaming') : t('about.oneShot')}</span>
              </SettingsRow>
              <SettingsRow label={t('about.currentWorkspace.label')} detail={activeWorkspace?.rootPath ?? t('about.currentWorkspace.none')}>
                <button className="ghost-button" type="button" onClick={() => activeWorkspace && void onOpenPath(activeWorkspace.rootPath)} disabled={!activeWorkspace}>
                  <FolderOpen size={15} />
                  {t('about.currentWorkspace.open')}
                </button>
              </SettingsRow>
              <SettingsRow label={t('about.logFile.label')} detail={t('about.logFile.detail', { days: settings.log.retentionDays })}>
                <button className="ghost-button" type="button" onClick={() => void onOpenLogFile()}>
                  <FileText size={15} />
                  {t('about.logFile.open')}
                </button>
              </SettingsRow>
              <SettingsRow label={t('about.appData.label')} detail={t('about.appData.detail')}>
                <button className="ghost-button" type="button" onClick={() => void onOpenAppDataDir()}>
                  <ArrowUpRight size={15} />
                  {t('about.appData.open')}
                </button>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}
      </div>
      </section>
    </div>
  )
}

function ConnectorStatusRow({ connector }: { connector: ConnectorStatus }) {
  const { t } = useTranslation()
  return (
    <div className="settings-connector-row" data-state={connector.state}>
      <div className="settings-connector-main">
        <span className="settings-connector-dot" aria-hidden="true" />
        <div className="settings-list-copy">
          <strong>{t(`connectors.items.${connector.id}`, { defaultValue: connector.name })}</strong>
          <span>{connector.detail}</span>
          {connector.repairAction ? <span>{connector.repairAction}</span> : null}
        </div>
      </div>
      <span className="settings-status-badge" data-state={connector.state}>
        {t(`connectors.status.${connector.state}`)}
      </span>
    </div>
  )
}

function MemoryDialog({
  dialog,
  draft,
  locale,
  onChange,
  onClose,
  onSave,
  t
}: {
  dialog: { mode: 'create' } | { mode: 'edit' | 'view'; memory: TeachingMemoryRecord }
  draft: { content: string; scope: TeachingMemoryScope; tags: string; confidence: number }
  locale: string
  onChange: (draft: { content: string; scope: TeachingMemoryScope; tags: string; confidence: number }) => void
  onClose: () => void
  onSave: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const editable = dialog.mode !== 'view'
  const memory = dialog.mode === 'create' ? null : dialog.memory
  const title = dialog.mode === 'create'
    ? t('memory.dialog.create')
    : dialog.mode === 'edit'
      ? t('memory.dialog.edit')
      : t('memory.dialog.view')

  return (
    <div className="memory-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="memory-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="memory-dialog-header">
          <div>
            <strong>{title}</strong>
            {memory && (
              <span>
                {memory.scope} · {new Date(memory.updatedAt).toLocaleString(locale)}
              </span>
            )}
          </div>
          <button className="settings-close-button" type="button" onClick={onClose} aria-label={t('memory.dialog.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="memory-dialog-body">
          {editable ? (
            <>
              <textarea
                className="settings-textarea"
                value={draft.content}
                placeholder={t('memory.dialog.contentPlaceholder')}
                onChange={(event) => onChange({ ...draft, content: event.target.value })}
              />
              <div className="settings-inline-group">
                {dialog.mode === 'create' && (
                  <SettingsSelect
                    value={draft.scope}
                    options={[
                      { value: 'workspace', label: t('memory.scope.workspace') },
                      { value: 'project', label: t('memory.scope.project') },
                      { value: 'user', label: t('memory.scope.user') }
                    ]}
                    onChange={(scope) => onChange({ ...draft, scope })}
                  />
                )}
                <SettingsTextInput
                  value={draft.tags}
                  placeholder={t('memory.dialog.tagsPlaceholder')}
                  onChange={(tags) => onChange({ ...draft, tags })}
                />
                <NumberInput
                  min={0}
                  max={1}
                  step={0.1}
                  value={draft.confidence}
                  onChange={(confidence) => onChange({ ...draft, confidence })}
                />
              </div>
            </>
          ) : (
            <div className="memory-dialog-readonly">{memory?.content}</div>
          )}
        </div>
        <div className="memory-dialog-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            {t('memory.dialog.cancel')}
          </button>
          {editable ? (
            <button className="ghost-button strong" type="button" onClick={onSave} disabled={!draft.content.trim()}>
              {t('memory.dialog.save')}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

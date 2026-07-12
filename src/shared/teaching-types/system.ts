export type NotificationPayload = {
  title: string
  body: string
}

export type ConnectorStatusState =
  | 'available'
  | 'disabled'
  | 'missing_config'
  | 'missing_dependency'
  | 'failed'

export type ConnectorStatus = {
  id: string
  name: string
  category: 'workspace' | 'web' | 'local'
  state: ConnectorStatusState
  detail: string
  repairAction?: string
}

export type ConnectorStatusesResult = {
  generatedAt: string
  connectors: ConnectorStatus[]
}

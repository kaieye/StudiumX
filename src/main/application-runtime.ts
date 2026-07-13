/**
 * The application runtime owns the one retained set of services created during
 * startup. Electron remains outside this module: callers supply the existing
 * side effects at their native seams while this runtime preserves their
 * lifecycle ordering.
 */
export interface ApplicationRuntimeSteps<BootingServices, Services = BootingServices> {
  /** Migrate durable data before any consumer can open it. */
  prepare(): Promise<void>
  /** Construct and retain the services used for this application lifetime. */
  create(): Promise<BootingServices>
  /** Repair interrupted durable work before it is exposed through IPC. */
  recover(services: BootingServices): Promise<Services>
  /** Publish runtime capabilities only after recovery has completed. */
  register(services: Services): void
  /** Create the initial desktop surface after all handlers are ready. */
  open(services: Services): void
  /** Apply live behavior after the first window has been created. */
  applyBehavior(services: Services): void
  /** Restore or create the desktop surface when the host activates the app. */
  activate(services: Services): void
  /** Flush the retained runtime exactly once during a real application quit. */
  drain(services: Services): Promise<void>
}

export interface ApplicationRuntime {
  start(): Promise<void>
  activate(): void
  /**
   * Begins the first real-quit drain and returns its promise. Later quit events
   * receive null so the host can let Electron complete the already-finalizing
   * quit without requesting another drain.
   */
  beginShutdown(): Promise<void> | null
}

/**
 * Compact composition-root lifecycle for one desktop application process.
 * Boot order is deliberately fixed: data preparation, construction, recovery,
 * registration, initial window, then live behavior.
 */
export function createApplicationRuntime<BootingServices, Services = BootingServices>(
  steps: ApplicationRuntimeSteps<BootingServices, Services>
): ApplicationRuntime {
  let services: Services | undefined
  let startup: Promise<void> | undefined
  let shutdown: Promise<void> | undefined

  const start = (): Promise<void> => {
    if (startup) return startup

    startup = (async () => {
      await steps.prepare()
      const createdServices = await steps.create()
      const recoveredServices = await steps.recover(createdServices)
      services = recoveredServices
      steps.register(recoveredServices)
      steps.open(recoveredServices)
      steps.applyBehavior(recoveredServices)
    })()

    return startup
  }

  return {
    start,
    activate(): void {
      if (services) steps.activate(services)
    },
    beginShutdown(): Promise<void> | null {
      const retainedServices = services
      if (!retainedServices || shutdown) return null
      shutdown = Promise.resolve().then(() => steps.drain(retainedServices))
      return shutdown
    }
  }
}
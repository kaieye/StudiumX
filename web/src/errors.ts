/**
 * Runtime error raised by the Web platform when an unsupported
 * `TeachingSystemApi` method is invoked.
 *
 * Phase 1 scaffold: the `window.teachingSystem` stub throws this for every
 * method. Phase 3 will replace the stub with a real HTTP adapter (plan §6.1)
 * that implements the supported subset and only throws this for the genuinely
 * unsupported methods (plan §4.2 / §7.2).
 */
export class WebNotSupportedError extends Error {
  readonly code = 'WEB_NOT_SUPPORTED' as const

  constructor(methodName: string) {
    super(
      '"' + methodName + '" is not available on StudiumX Web. ' +
        'This capability requires the desktop app.'
    )
    this.name = 'WebNotSupportedError'
    Object.setPrototypeOf(this, WebNotSupportedError.prototype)
  }
}

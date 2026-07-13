import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

class ResizeObserverStub implements ResizeObserver {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
}

class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly scrollMargin = '0px'
  readonly thresholds = [0]

  disconnect = vi.fn()
  observe = vi.fn()
  takeRecords = vi.fn(() => [])
  unobserve = vi.fn()
}

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: vi.fn().mockImplementation((query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  }))
})

vi.stubGlobal('ResizeObserver', ResizeObserverStub)
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  writable: true,
  value: vi.fn()
})

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn()
}

if (!globalThis.requestAnimationFrame) {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0)
  )
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

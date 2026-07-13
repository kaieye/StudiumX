import type { ReactElement } from 'react'
import {
  render,
  type RenderOptions,
  type RenderResult
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'

interface RenderUiOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapper?: RenderOptions['wrapper']
}

export function renderUi(
  ui: ReactElement,
  { wrapper, ...options }: RenderUiOptions = {}
): RenderResult {
  return render(ui, { ...options, ...(wrapper ? { wrapper } : {}) })
}

export function setupUser() {
  return userEvent.setup()
}

export * from '@testing-library/react'

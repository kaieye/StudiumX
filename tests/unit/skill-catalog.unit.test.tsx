import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderUi, screen, waitFor } from '../helpers/render'
import { announceSkillCatalogChanged, useSkillCatalog } from '../../src/renderer/src/skills/skillCatalog'
import type { SkillCatalogResult } from '../../src/shared/teaching-types'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function CatalogHarness() {
  const { catalog } = useSkillCatalog()
  return <output data-testid="catalog-skill">{catalog.skills[0]?.id ?? ''}</output>
}

const originalTeachingSystem = window.teachingSystem
afterEach(() => {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: originalTeachingSystem
  })
})

const snapshot = (id: string): SkillCatalogResult => ({
  rootPath: '',
  skills: [{
    id,
    name: id,
    description: id,
    category: 'learning',
    icon: 'sparkles',
    author: 'StudiumX',
    command: `/${id}`,
    source: 'builtin',
    installed: id !== 'old-skill'
  }]
})

describe('skill catalog refresh', () => {
  it('does not let an older in-flight catalog response overwrite an install refresh', async () => {
    const initial = deferred<SkillCatalogResult>()
    const refreshed = deferred<SkillCatalogResult>()
    const listSkills = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refreshed.promise)
    Object.defineProperty(window, 'teachingSystem', {
      configurable: true,
      writable: true,
      value: { listSkills }
    })

    const rendered = renderUi(<CatalogHarness />)
    await waitFor(() => expect(listSkills).toHaveBeenCalledTimes(1))

    announceSkillCatalogChanged()
    await waitFor(() => expect(listSkills).toHaveBeenCalledTimes(2))

    refreshed.resolve(snapshot('installed-skill'))
    await waitFor(() => expect(screen.getByTestId('catalog-skill')).toHaveTextContent('installed-skill'))

    initial.resolve(snapshot('old-skill'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByTestId('catalog-skill')).toHaveTextContent('installed-skill')

    rendered.unmount()
    renderUi(<CatalogHarness />)
    expect(screen.getByTestId('catalog-skill')).toHaveTextContent('installed-skill')
  })
})

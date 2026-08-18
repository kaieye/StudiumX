import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { MindMapTopicStyleInspector } from '../../src/renderer/src/views/mindmap/MindMapTopicStyleInspector'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import { mindMapTopicStyleOverrideSchema } from '../../src/shared/mindmap/domain/schema'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { TeachingSystemApi, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

const NOW = '2026-08-09T00:00:00.000Z'
const originalMindMapState = useMindMapViewStore.getState()
const originalAppState = useAppStore.getState()
const originalTeachingSystemDescriptor = Object.getOwnPropertyDescriptor(window, 'teachingSystem')

function workspace(): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1',
    name: 'Test workspace',
    rootPath: '/workspace',
    missionPath: '/workspace/MISSION.md',
    resourcesPath: '/workspace/resources',
    lessonsDir: '/workspace/lessons',
    recordsDir: '/workspace/records',
    referenceDir: '/workspace/reference',
    reviewsDir: '/workspace/reviews',
    createdAt: NOW,
    updatedAt: NOW,
    agentWorkspaceTrust: 'trusted',
    missionTitle: 'Test workspace',
    missionExcerpt: 'Test workspace',
    courses: [],
    fileTree: [],
    conversations: [],
    resources: [],
    records: [],
    lessons: [],
    referenceCount: 0,
    assetsReady: true,
    git: null
  }
}

function makeDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'mind-map-1',
    revision: 1,
    title: 'Study map',
    createdAt: NOW,
    updatedAt: NOW,
    theme: { id: 'studiumx-default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root',
          title: 'Root topic',
          planning: { taskStatus: 'doing', priority: 4 },
          style: { fill: '#123456', stroke: '#111111', fontWeight: '600' },
          children: [
            {
              id: 'child',
              title: 'Child topic',
              style: {
                fill: '#654321',
                stroke: '#222222',
                fontWeight: '400',
                structureClass: 'studiumx.layout.logic.left'
              },
              children: [
                {
                  id: 'grandchild',
                  title: 'Grandchild topic',
                  style: { fill: '#ABCDEF' },
                  children: []
                }
              ]
            },
            {
              id: 'peer',
              title: 'Peer topic',
              style: { fill: '#FEDCBA', textColor: '#333333' },
              children: []
            }
          ]
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  await i18n.changeLanguage('en-US')
  useAppStore.setState({
    ...originalAppState,
    appState: {
      ...originalAppState.appState,
      activeWorkspace: workspace()
    }
  })

  const document = makeDocument()
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: {
      readMindMap: vi.fn(async () => document),
      listMindMaps: vi.fn(async () => []),
      updateMindMap: vi.fn(async (payload) => ({ ok: true as const, document: payload.doc }))
    } as Partial<TeachingSystemApi>
  })

  await useMindMapViewStore.getState().openDocument(document.id)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  useMindMapViewStore.setState(originalMindMapState)
  useAppStore.setState(originalAppState)
  if (originalTeachingSystemDescriptor) {
    Object.defineProperty(window, 'teachingSystem', originalTeachingSystemDescriptor)
  } else {
    delete (window as unknown as { teachingSystem?: TeachingSystemApi }).teachingSystem
  }
  vi.restoreAllMocks()
})

function chooseTopicStyleMenuOption(menuLabel: string, optionLabel: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${menuLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `) }))
  const dialog = screen.getByRole('dialog', { name: menuLabel })
  const target = within(dialog).queryByRole('option', { name: optionLabel })
    ?? within(dialog).queryByRole('button', { name: optionLabel })
    ?? within(dialog).getByRole('button', { name: `Preset color ${optionLabel}` })
  fireEvent.click(target)
}

describe('MindMapTopicStyleInspector', () => {
  it('shows the effective sheet layout for the selected topic', () => {
    render(<MindMapTopicStyleInspector />)

    expect(screen.getByText('Node style')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Node layout' })).toHaveValue('studiumx.layout.logic.right')
    expect(screen.getByText('Effective layout: Right')).toBeInTheDocument()
  })

  it('collapses and expands the current topic and all branch topics at the same level', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.children[1]!.children.push({
      id: 'peer-child',
      title: 'Peer child',
      children: []
    })
    useMindMapViewStore.setState({
      current: structuredClone(current),
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse current child nodes' }))
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]?.collapsed).toBe(true)
    expect(screen.getByRole('button', { name: 'Expand current child nodes' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all sibling child nodes' }))
    const collapsedSiblings = useMindMapViewStore.getState().current?.sheets[0]?.root.children
    expect(collapsedSiblings?.map((topic) => topic.collapsed)).toEqual([true, true])
    expect(screen.getByRole('button', { name: 'Expand all sibling child nodes' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all sibling child nodes' }))
    const expandedSiblings = useMindMapViewStore.getState().current?.sheets[0]?.root.children
    expect(expandedSiblings?.map((topic) => topic.collapsed)).toEqual([false, false])
  })

  it('shows concrete defaults instead of source labels when a topic has no local setting', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = undefined
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('button', { name: 'Shape Rounded Rect' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fill Pattern Solid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fill Color #FFFFFF' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Border Style Solid' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Font Weight' })).toHaveValue('600')
    expect(screen.getByRole('spinbutton', { name: 'Font Size' })).toHaveValue(26)
  })

  it('updates only the layout override and keeps unrelated style fields', () => {
    render(<MindMapTopicStyleInspector />)
    const select = screen.getByRole('combobox', { name: 'Node layout' })

    fireEvent.change(select, { target: { value: 'studiumx.layout.logic.balanced' } })

    const topic = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(topic?.style).toEqual({
      fill: '#123456',
      stroke: '#111111',
      fontWeight: '600',
      structureClass: 'studiumx.layout.logic.balanced'
    })
    expect(screen.getByText('Effective layout: Balanced')).toBeInTheDocument()
  })

  it('clears the override to inherit again and remains undoable', () => {
    render(<MindMapTopicStyleInspector />)
    const select = screen.getByRole('combobox', { name: 'Node layout' })

    fireEvent.change(select, { target: { value: 'studiumx.layout.logic.left' } })
    fireEvent.change(select, { target: { value: '' } })

    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style).toEqual({
      fill: '#123456',
      stroke: '#111111',
      fontWeight: '600'
    })
    expect(select).toHaveValue('studiumx.layout.logic.right')

    act(() => {
      useMindMapViewStore.getState().undo()
    })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style).toEqual({
      fill: '#123456',
      stroke: '#111111',
      fontWeight: '600',
      structureClass: 'studiumx.layout.logic.left'
    })
    expect(select).toHaveValue('studiumx.layout.logic.left')
  })

  it('shows mixed values for a topic multi-selection instead of the primary topic value', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    expect(screen.getByText('2 nodes selected')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Font Weight' })).toHaveValue('__mixed__')
    expect(screen.getByRole('combobox', { name: 'Node layout' })).toHaveValue('__mixed__')
    expect(screen.getAllByRole('option', { name: 'Mixed' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: 'Fill Color Mixed' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Border Color Mixed' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: 'Fill Color' })).not.toBeInTheDocument()
  })

  it('updates one field across selected topics as one undo unit and preserves unrelated fields', async () => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    chooseTopicStyleMenuOption('Fill Color', '#4A90D9')

    let root = useMindMapViewStore.getState().current?.sheets[0]?.root
    let child = root?.children[0]
    expect(root?.style).toEqual({ fill: '#4A90D9', stroke: '#111111', fontWeight: '600' })
    expect(child?.style).toEqual({
      fill: '#4A90D9',
      stroke: '#222222',
      fontWeight: '400',
      structureClass: 'studiumx.layout.logic.left'
    })

    act(() => useMindMapViewStore.getState().undo())
    root = useMindMapViewStore.getState().current?.sheets[0]?.root
    child = root?.children[0]
    expect(root?.style?.fill).toBe('#123456')
    expect(child?.style?.fill).toBe('#654321')

    act(() => useMindMapViewStore.getState().redo())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    const updateMindMap = vi.mocked(window.teachingSystem!.updateMindMap)
    expect(updateMindMap).toHaveBeenCalledTimes(1)
    const persisted = updateMindMap.mock.calls[0]?.[0].doc
    expect(persisted.sheets[0]?.root.style?.fill).toBe('#4A90D9')
    expect(persisted.sheets[0]?.root.children[0]?.style?.fill).toBe('#4A90D9')
  })

  it('updates border pattern and width with undo, redo, and revisioned persistence', async () => {
    render(<MindMapTopicStyleInspector />)

    chooseTopicStyleMenuOption('Border Style', 'Dash')
    chooseTopicStyleMenuOption('Border Width', '5')

    let style = useMindMapViewStore.getState().current?.sheets[0]?.root.style
    expect(style).toEqual({
      fill: '#123456',
      stroke: '#111111',
      borderStyle: 'dash',
      borderWidth: 5,
      fontWeight: '600'
    })

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.borderWidth).toBeUndefined()
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.borderStyle).toBe('dash')

    act(() => useMindMapViewStore.getState().redo())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    style = useMindMapViewStore.getState().current?.sheets[0]?.root.style
    expect(style?.borderWidth).toBe(5)
    const updateMindMap = vi.mocked(window.teachingSystem!.updateMindMap)
    expect(updateMindMap).toHaveBeenCalledTimes(1)
    expect(updateMindMap.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 1,
      doc: {
        sheets: [{ root: { style: { borderStyle: 'dash', borderWidth: 5 } } }]
      }
    })
  })

  it('disables border color and width for None without discarding their overrides', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = {
      ...current.sheets[0]!.root.style,
      borderStyle: 'solid',
      borderWidth: 3
    }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapTopicStyleInspector />)

    chooseTopicStyleMenuOption('Border Style', 'None')

    expect(screen.getByRole('button', { name: /^Border Color / })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Border Width / })).toBeDisabled()
    expect(screen.getByText('Border color and width are unavailable while border style is None.')).toBeInTheDocument()
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style).toMatchObject({
      stroke: '#111111',
      borderStyle: 'none',
      borderWidth: 3
    })
  })

  it('keeps a valid imported border width visible instead of treating it as inheritance', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = {
      ...current.sheets[0]!.root.style,
      borderWidth: 0.75
    }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapTopicStyleInspector />)

    const trigger = screen.getByRole('button', { name: 'Border Width 0.75' })
    fireEvent.click(trigger)
    expect(within(screen.getByRole('dialog', { name: 'Border Width' })).getByRole('option', { name: '0.75' }))
      .toHaveAttribute('aria-selected', 'true')
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.borderWidth).toBe(0.75)
  })

  it('restores retained border color and width after switching None back to Solid', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = {
      ...current.sheets[0]!.root.style,
      borderStyle: 'none',
      borderWidth: 3
    }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapTopicStyleInspector />)

    chooseTopicStyleMenuOption('Border Style', 'Solid')

    expect(screen.getByRole('button', { name: 'Border Width 3' })).not.toBeDisabled()
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style).toMatchObject({
      stroke: '#111111',
      borderStyle: 'solid',
      borderWidth: 3
    })
  })

  it('shows mixed border patterns and changes only that field across a multi-selection', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = {
      ...current.sheets[0]!.root.style,
      borderStyle: 'dash',
      borderWidth: 3
    }
    current.sheets[0]!.root.children[0]!.style = {
      ...current.sheets[0]!.root.children[0]!.style,
      borderStyle: 'solid',
      borderWidth: 5
    }
    useMindMapViewStore.setState({
      current: structuredClone(current),
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('button', { name: 'Border Style Mixed' })).toHaveAttribute('aria-expanded', 'false')
    chooseTopicStyleMenuOption('Border Style', 'Hand-drawn Dash')

    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.style).toMatchObject({
      stroke: '#111111',
      borderStyle: 'hand-drawn-dash',
      borderWidth: 3
    })
    expect(root?.children[0]?.style).toMatchObject({
      stroke: '#222222',
      borderStyle: 'hand-drawn-dash',
      borderWidth: 5
    })
  })

  it('shows the effective None border style while gating dependent fields', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme = {
      ...current.theme,
      topicStyles: {
        ...current.theme.topicStyles,
        central: { borderStyle: 'none', stroke: '#998877', borderWidth: 3 }
      }
    }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('button', { name: 'Border Style None' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^Border Width / })).toBeDisabled()

    chooseTopicStyleMenuOption('Border Style', 'Solid')
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.borderStyle).toBe('solid')
    expect(screen.getByRole('button', { name: /^Border Width / })).not.toBeDisabled()
  })

  it('toggles bold and italic independently as persisted topic style fields', async () => {
    render(<MindMapTopicStyleInspector />)

    const bold = screen.getByRole('button', { name: 'Bold' })
    const italic = screen.getByRole('button', { name: 'Italic' })
    expect(bold).toHaveAttribute('aria-pressed', 'false')
    expect(italic).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(bold)
    fireEvent.click(italic)

    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style).toMatchObject({
      fontWeight: '700',
      fontStyle: 'italic'
    })
    expect(bold).toHaveAttribute('aria-pressed', 'true')
    expect(italic).toHaveAttribute('aria-pressed', 'true')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    const persisted = vi.mocked(window.teachingSystem!.updateMindMap).mock.calls[0]?.[0].doc
    expect(persisted.sheets[0]?.root.style?.fontWeight).toBe('700')
    expect(persisted.sheets[0]?.root.style?.fontStyle).toBe('italic')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fontStyle).toBeUndefined()
  })

  it('shows inherited italic as active and writes an explicit normal override when disabled', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.topicStyles = { central: { fontStyle: 'italic' } }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapTopicStyleInspector />)

    const italic = screen.getByRole('button', { name: 'Italic' })
    expect(italic).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(italic)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fontStyle).toBe('normal')
    expect(italic).toHaveAttribute('aria-pressed', 'false')
  })

  it('combines underline and strikethrough independently with one undo entry per click', () => {
    render(<MindMapTopicStyleInspector />)

    const underline = screen.getByRole('button', { name: 'Underline' })
    const strikethrough = within(
      screen.getByRole('group', { name: 'Emphasis' })
    ).getByRole('button', { name: 'Strikethrough' })
    expect(underline).toHaveAttribute('aria-pressed', 'false')
    expect(strikethrough).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(underline)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.textDecoration)
      .toBe('underline')

    fireEvent.click(strikethrough)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.textDecoration)
      .toBe('line-through underline')
    expect(underline).toHaveAttribute('aria-pressed', 'true')
    expect(strikethrough).toHaveAttribute('aria-pressed', 'true')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.textDecoration)
      .toBe('underline')

    act(() => useMindMapViewStore.getState().redo())
    fireEvent.click(underline)
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.textDecoration)
      .toBe('line-through')
  })

  it('writes explicit none when disabling an inherited decoration and persists it', async () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.topicStyles = { central: { textDecoration: 'underline' } }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapTopicStyleInspector />)

    const underline = screen.getByRole('button', { name: 'Underline' })
    expect(underline).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(underline)

    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.textDecoration)
      .toBe('none')
    expect(underline).toHaveAttribute('aria-pressed', 'false')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    const persisted = vi.mocked(window.teachingSystem!.updateMindMap).mock.calls[0]?.[0].doc
    expect(persisted.sheets[0]?.root.style?.textDecoration).toBe('none')
  })

  it('announces mixed inherited decoration and applies only that flag across the selection', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.topicStyles = {
      central: { textDecoration: 'underline' },
      main: { textDecoration: 'none' }
    }
    if (current.sheets[0]!.root.style) {
      delete current.sheets[0]!.root.style.textDecoration
    }
    current.sheets[0]!.root.children[0]!.style = {
      ...current.sheets[0]!.root.children[0]!.style,
      textDecoration: 'line-through'
    }
    useMindMapViewStore.setState({
      current: structuredClone(current),
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    const underline = screen.getByRole('button', { name: 'Underline — Mixed' })
    const strikethrough = screen.getByRole('button', { name: 'Strikethrough — Mixed' })
    expect(underline).toHaveAttribute('aria-pressed', 'mixed')
    expect(strikethrough).toHaveAttribute('aria-pressed', 'mixed')

    fireEvent.click(underline)
    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    const child = root?.children[0]
    expect(root?.style?.textDecoration).toBeUndefined()
    expect(child?.style?.textDecoration).toBe('line-through underline')
  })

  it('changes visual letter case without rewriting the canonical topic title', async () => {
    render(<MindMapTopicStyleInspector />)

    const select = screen.getByRole('combobox', { name: 'Letter Case' })
    expect(select).toHaveValue('none')
    fireEvent.change(select, { target: { value: 'uppercase' } })

    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.title).toBe('Root topic')
    expect(root?.style?.textTransform).toBe('uppercase')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    const persisted = vi.mocked(window.teachingSystem!.updateMindMap).mock.calls[0]?.[0].doc
    expect(persisted.sheets[0]?.root.title).toBe('Root topic')
    expect(persisted.sheets[0]?.root.style?.textTransform).toBe('uppercase')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.textTransform)
      .toBeUndefined()
  })

  it('shows mixed letter case and applies one value to all selected topics', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = {
      ...current.sheets[0]!.root.style,
      textTransform: 'uppercase'
    }
    current.sheets[0]!.root.children[0]!.style = {
      ...current.sheets[0]!.root.children[0]!.style,
      textTransform: 'lowercase'
    }
    useMindMapViewStore.setState({
      current: structuredClone(current),
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    const select = screen.getByRole('combobox', { name: 'Letter Case' })
    expect(select).toHaveValue('__mixed__')
    fireEvent.change(select, { target: { value: 'capitalize' } })

    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.style?.textTransform).toBe('capitalize')
    expect(root?.children[0]?.style?.textTransform).toBe('capitalize')
    expect(root?.title).toBe('Root topic')
    expect(root?.children[0]?.title).toBe('Child topic')
  })

  it('uses explicit none to override an inherited transform and can restore inheritance', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.topicStyles = { central: { textTransform: 'uppercase' } }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    render(<MindMapTopicStyleInspector />)

    const select = screen.getByRole('combobox', { name: 'Letter Case' })
    expect(select).toHaveValue('uppercase')
    fireEvent.change(select, { target: { value: 'none' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.textTransform)
      .toBe('none')

    fireEvent.change(select, { target: { value: '' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.textTransform)
      .toBeUndefined()
  })

  it('shows the structural alignment default and stores only a non-default override', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.children[0]!.style = {
      ...current.sheets[0]!.root.children[0]!.style,
      structureClass: undefined
    }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    const select = screen.getByRole('combobox', { name: 'Text Align' })
    expect(select).toHaveValue('left')

    fireEvent.change(select, { target: { value: 'right' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]?.style?.textAlign)
      .toBe('right')

    fireEvent.change(select, { target: { value: 'left' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]?.style?.textAlign)
      .toBeUndefined()
  })

  it('uses a topic-local structure override for the alignment fallback', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('combobox', { name: 'Text Align' })).toHaveValue('right')
  })

  it('persists an explicit alignment only while it differs from the inherited theme value', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.topicStyles = { main: { textAlign: 'right' } }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    const select = screen.getByRole('combobox', { name: 'Text Align' })
    expect(select).toHaveValue('right')

    fireEvent.change(select, { target: { value: 'left' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]?.style?.textAlign)
      .toBe('left')

    fireEvent.change(select, { target: { value: 'right' } })
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]?.style?.textAlign)
      .toBeUndefined()
  })

  it('shows mixed effective alignment and applies one value to all selected topics', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    const select = screen.getByRole('combobox', { name: 'Text Align' })
    expect(select).toHaveValue('__mixed__')
    fireEvent.change(select, { target: { value: 'center' } })

    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.style?.textAlign).toBeUndefined()
    expect(root?.children[0]?.style?.textAlign).toBe('center')
  })

  it('normalizes legacy bold and normal tokens in the inspector', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = { ...current.sheets[0]!.root.style, fontWeight: 'bold' }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    const { rerender } = render(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('combobox', { name: 'Font Weight' })).toHaveValue('700')
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')

    const next = useMindMapViewStore.getState().current
    if (!next) throw new Error('expected current document')
    next.sheets[0]!.root.style = { ...next.sheets[0]!.root.style, fontWeight: 'normal' }
    useMindMapViewStore.setState({ current: structuredClone(next) })
    rerender(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('combobox', { name: 'Font Weight' })).toHaveValue('400')
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('announces mixed inherited emphasis across topic depths', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.theme.topicStyles = {
      central: { fontWeight: 'bold', fontStyle: 'italic' },
      main: { fontWeight: 'normal', fontStyle: 'normal' }
    }
    if (current.sheets[0]?.root.style) delete current.sheets[0].root.style.fontWeight
    if (current.sheets[0]?.root.children[0]?.style) {
      delete current.sheets[0].root.children[0].style.fontWeight
    }
    useMindMapViewStore.setState({
      current: structuredClone(current),
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('button', { name: 'Bold — Mixed' })).toHaveAttribute('aria-pressed', 'mixed')
    expect(screen.getByRole('button', { name: 'Italic — Mixed' })).toHaveAttribute('aria-pressed', 'mixed')
  })

  it('accepts arbitrary valid font sizes and merges one continuous edit into one undo step', () => {
    render(<MindMapTopicStyleInspector />)

    const fontSize = screen.getByRole('spinbutton', { name: 'Font Size' })
    fireEvent.focus(fontSize)
    fireEvent.change(fontSize, { target: { value: '17' } })
    fireEvent.change(fontSize, { target: { value: '17.5' } })

    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fontSize).toBe(17.5)

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fontSize).toBeUndefined()

    act(() => useMindMapViewStore.getState().redo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fontSize).toBe(17.5)

    fireEvent.blur(fontSize)
    fireEvent.focus(fontSize)
    fireEvent.change(fontSize, { target: { value: '19.25' } })
    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fontSize).toBe(17.5)
  })

  it('does not dispatch font sizes outside the shared schema range', () => {
    render(<MindMapTopicStyleInspector />)

    const fontSize = screen.getByRole('spinbutton', { name: 'Font Size' })
    fireEvent.focus(fontSize)
    fireEvent.change(fontSize, { target: { value: '513' } })

    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fontSize).toBeUndefined()
  })

  it('announces mixed emphasis values and applies them across a topic selection', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = { ...current.sheets[0]!.root.style, fontStyle: 'italic' }
    useMindMapViewStore.setState({
      current: structuredClone(current),
      selection: { kind: 'topic', topicIds: ['root', 'child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    const italic = screen.getByRole('button', { name: 'Italic — Mixed' })
    expect(italic).toHaveAttribute('aria-pressed', 'mixed')
    fireEvent.click(italic)

    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.style?.fontStyle).toBe('italic')
    expect(root?.children[0]?.style?.fontStyle).toBe('italic')
  })

  it('propagates the complete local style to every descendant as one undoable persisted change', async () => {
    render(<MindMapTopicStyleInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Descendants (3)' }))

    let root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.children[0]?.style).toEqual(root?.style)
    expect(root?.children[0]?.children[0]?.style).toEqual(root?.style)
    expect(root?.children[1]?.style).toEqual(root?.style)

    act(() => useMindMapViewStore.getState().undo())
    root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.children[0]?.style?.fill).toBe('#654321')
    expect(root?.children[0]?.children[0]?.style).toEqual({ fill: '#ABCDEF' })
    expect(root?.children[1]?.style).toEqual({ fill: '#FEDCBA', textColor: '#333333' })

    act(() => useMindMapViewStore.getState().redo())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    const updateMindMap = vi.mocked(window.teachingSystem!.updateMindMap)
    expect(updateMindMap).toHaveBeenCalledTimes(1)
    const persistedRoot = updateMindMap.mock.calls[0]?.[0].doc.sheets[0]?.root
    expect(persistedRoot?.children[0]?.children[0]?.style).toEqual(persistedRoot?.style)
  })

  it('selects a new topic shape and persists it as a revisioned undoable change', async () => {
    render(<MindMapTopicStyleInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Shape Rounded Rect' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Choose shape' })).getByRole('option', { name: 'Diamond' }))

    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.style?.shape).toBe('diamond')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.shape).toBeUndefined()

    act(() => useMindMapViewStore.getState().redo())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    const updateMindMap = vi.mocked(window.teachingSystem!.updateMindMap)
    expect(updateMindMap).toHaveBeenCalledTimes(1)
    expect(updateMindMap.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 1,
      doc: { sheets: [{ root: { style: { shape: 'diamond' } } }] }
    })
  })

  it('selects a fill pattern and persists it as a revisioned undoable change', async () => {
    render(<MindMapTopicStyleInspector />)

    chooseTopicStyleMenuOption('Fill Pattern', 'Hand-drawn')
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fillPattern).toBe('hand-drawn')

    act(() => useMindMapViewStore.getState().undo())
    expect(useMindMapViewStore.getState().current?.sheets[0]?.root.style?.fillPattern).toBeUndefined()

    act(() => useMindMapViewStore.getState().redo())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    const updateMindMap = vi.mocked(window.teachingSystem!.updateMindMap)
    expect(updateMindMap).toHaveBeenCalledTimes(1)
    expect(updateMindMap.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 1,
      doc: { sheets: [{ root: { style: { fillPattern: 'hand-drawn' } } }] }
    })
  })

  it('shows app, document, theme-layer, and local font provenance without writing an override', () => {
    const current = useMindMapViewStore.getState().current
    if (!current) throw new Error('expected current document')
    current.sheets[0]!.root.style = { ...current.sheets[0]!.root.style, fontFamily: undefined }
    useMindMapViewStore.setState({ current: structuredClone(current) })
    const { rerender } = render(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('status')).toHaveTextContent('Font source: App fallback')

    const withDocumentFont = useMindMapViewStore.getState().current
    if (!withDocumentFont) throw new Error('expected current document')
    withDocumentFont.theme.fontFamily = 'Inter, system-ui, sans-serif'
    useMindMapViewStore.setState({ current: structuredClone(withDocumentFont) })
    rerender(<MindMapTopicStyleInspector />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Font source: Document font (Inter, system-ui, sans-serif)'
    )

    const withThemeLayerFont = useMindMapViewStore.getState().current
    if (!withThemeLayerFont) throw new Error('expected current document')
    delete withThemeLayerFont.theme.fontFamily
    withThemeLayerFont.theme.topicStyles = { central: { fontFamily: 'Arial, Helvetica, sans-serif' } }
    useMindMapViewStore.setState({ current: structuredClone(withThemeLayerFont) })
    rerender(<MindMapTopicStyleInspector />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Font source: Theme layer (Arial, Helvetica, sans-serif)'
    )

    const withLocalFont = useMindMapViewStore.getState().current
    if (!withLocalFont) throw new Error('expected current document')
    withLocalFont.sheets[0]!.root.style = {
      ...withLocalFont.sheets[0]!.root.style,
      fontFamily: 'Imported native Font, sans-serif'
    }
    useMindMapViewStore.setState({ current: structuredClone(withLocalFont) })
    rerender(<MindMapTopicStyleInspector />)

    expect(screen.getByRole('button', { name: /Imported native Font/ })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /Font source:/ })).toHaveTextContent(
      'Font source: Local override (Imported native Font, sans-serif)'
    )
    expect(screen.getByText('Requested imported or custom font may fall back in this app.')).toBeInTheDocument()
  })

  it('propagates a selected topic style to its siblings without changing descendants', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Siblings (1)' }))

    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.children[1]?.style).toEqual(root?.children[0]?.style)
    expect(root?.children[0]?.children[0]?.style).toEqual({ fill: '#ABCDEF' })
  })

  it('configures topic numbering and applies it to siblings in one undoable transaction', () => {
    useMindMapViewStore.setState({
      selection: { kind: 'topic', topicIds: ['child'] },
      selectedNodeId: 'child'
    })
    render(<MindMapTopicStyleInspector />)

    // Number format starts as inherit (no local override).
    const pattern = screen.getByRole('combobox', { name: 'Number format' })
    expect(pattern).toHaveValue('')
    fireEvent.change(pattern, { target: { value: 'arabic' } })

    let child = useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]
    expect(child?.numbering).toEqual({ pattern: 'arabic' })

    fireEvent.click(screen.getByRole('button', { name: 'Tiered numbers' }))
    child = useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]
    expect(child?.numbering).toEqual({ pattern: 'arabic', tiered: true })

    fireEvent.click(screen.getByRole('button', { name: 'Restart numbering here' }))
    child = useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]
    expect(child?.numbering).toEqual({ pattern: 'arabic', tiered: true, restartAt: 1 })

    const restartAt = screen.getByRole('spinbutton', { name: 'Restart at' })
    fireEvent.change(restartAt, { target: { value: '3' } })
    child = useMindMapViewStore.getState().current?.sheets[0]?.root.children[0]
    expect(child?.numbering).toEqual({ pattern: 'arabic', tiered: true, restartAt: 3 })

    // Apply to the single sibling as one undoable transaction.
    fireEvent.click(screen.getByRole('button', { name: 'Apply numbering to siblings' }))
    let root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.children[1]?.numbering).toEqual({ pattern: 'arabic', tiered: true, restartAt: 3 })

    act(() => {
      useMindMapViewStore.getState().undo()
    })
    root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.children[1]?.numbering).toBeUndefined()
  })

  it('writes an 8-digit fill color with transparency through the command path', () => {
    render(<MindMapTopicStyleInspector />)

    fireEvent.click(screen.getByRole('button', { name: 'Fill Color #123456' }))
    const dialog = screen.getByRole('dialog', { name: 'Fill Color' })
    fireEvent.change(
      within(dialog).getByRole('slider', { name: 'Background opacity' }),
      { target: { value: '50' } }
    )

    const root = useMindMapViewStore.getState().current?.sheets[0]?.root
    expect(root?.style?.fill).toBe('#12345680')
  })

  it('accepts an 8-digit alpha color in the persisted topic style schema', () => {
    const parsed = mindMapTopicStyleOverrideSchema.safeParse({ fill: '#12345680', stroke: '#111111' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.fill).toBe('#12345680')
    }
  })
})

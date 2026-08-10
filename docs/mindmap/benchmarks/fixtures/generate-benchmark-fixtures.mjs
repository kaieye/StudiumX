#!/usr/bin/env node
/**
 * Deterministic generator for the mind-map M0 benchmark fixtures.
 *
 * Produces:
 *  - v2 MindMapDocument fixtures: doc-{10,100,500,2000}-nodes.v2.json
 *  - XMind content.json fixtures: xmind-content-*.json
 *  - corrupted .xmind ZIP fixtures: xmind-corrupt-*.xmind
 *
 * The generator is placed next to the fixtures so the matrix can be
 * regenerated/reproduced on a benchmark machine. Run from the repo root:
 *
 *   node docs/mindmap/benchmarks/fixtures/generate-benchmark-fixtures.mjs
 *
 * Deterministic: every run with the same seed produces byte-identical output.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { strToU8, zipSync } from 'fflate'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = HERE

const NOW = '2026-08-09T00:00:00.000Z'
const SEED = 0x5eed_2026

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeTopic(id, title) {
  return { id, title, children: [] }
}

function titleFor(n) {
  return `Node ${n}`
}

/**
 * Generate a topic tree with exactly `target` nodes.
 * - `minDepth` / `maxDepth` (root = depth 1) bound the tree shape.
 * - Branching is random-but-deterministic within the depth bounds.
 */
function generateTree(target, { minDepth, maxDepth, idPrefix, seed = SEED }) {
  const rand = mulberry32(seed)
  const root = makeTopic(`${idPrefix}-n1`, 'Root')
  const nodes = [root]
  const depth = new Map([[root.id, 1]])
  const open = [root]
  let nextId = 1

  function newNode(parent) {
    nextId += 1
    const id = `${idPrefix}-n${nextId}`
    const node = makeTopic(id, titleFor(nextId))
    parent.children.push(node)
    nodes.push(node)
    const parentDepth = depth.get(parent.id) ?? 1
    const d = parentDepth + 1
    depth.set(id, d)
    if (d < maxDepth) open.push(node)
    return node
  }

  // Build a spine down to minDepth so the fixture reaches the requested depth.
  let cursor = root
  for (let i = 1; i < minDepth; i += 1) {
    cursor = newNode(cursor)
  }

  // Fill remaining nodes by attaching to a random node that can still grow.
  while (nodes.length < target) {
    const candidates = open.filter((node) => (depth.get(node.id) ?? 1) < maxDepth)
    if (candidates.length === 0) break
    const parent = candidates[Math.floor(rand() * candidates.length)]
    newNode(parent)
  }

  return root
}

/** Count nodes in a topic tree. */
function countNodes(root) {
  let count = 0
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    count += 1
    for (const child of node.children) stack.push(child)
  }
  return count
}

/** Mark ~1/5 of interior nodes collapsed (deterministic by position). */
function applyCollapsed(root, every = 5) {
  let index = 0
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    index += 1
    if (node.children.length > 0 && index % every === 0) {
      node.collapsed = true
    }
    for (const child of node.children) stack.push(child)
  }
}

/** Collect node ids in document order (pre-order, depth-first). */
function collectIds(root) {
  const ids = []
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    ids.push(node.id)
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i])
    }
  }
  return ids
}

/** Build a v2 sheet with a tree and a few elements referencing real ids. */
function buildSheet(sheetId, sheetTitle, tree, { withElements }) {
  const ids = collectIds(tree)
  const elements = []
  if (withElements && ids.length >= 4) {
    elements.push({
      id: `${sheetId}-rel-1`,
      type: 'relationship',
      label: '依赖',
      from: ids[0],
      to: ids[1]
    })
  }
  if (withElements && ids.length >= 5) {
    elements.push({
      id: `${sheetId}-sum-1`,
      type: 'summary',
      label: '总结',
      from: ids[1],
      to: ids[2]
    })
  }
  if (withElements && ids.length >= 6) {
    elements.push({
      id: `${sheetId}-boundary-1`,
      type: 'boundary',
      label: '外框',
      topicId: ids[1]
    })
  }
  if (withElements && ids.length >= 7) {
    elements.push({
      id: `${sheetId}-callout-1`,
      type: 'callout',
      label: '标注',
      topicId: ids[2],
      text: 'callout note',
      position: { x: 120, y: 40 }
    })
  }
  if (withElements && ids.length >= 8) {
    elements.push({
      id: `${sheetId}-free-1`,
      type: 'free-topic',
      label: '自由主题',
      topicId: ids[3],
      position: { x: 200, y: 80 }
    })
  }
  return {
    id: sheetId,
    title: sheetTitle,
    root: tree,
    elements,
    layout: { structureClass: 'org.xmind.ui.logic.right' },
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

/** Build a v2 MindMapDocument fixture. */
function buildV2Document(opts) {
  const { id, title, sheets } = opts
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    title,
    createdAt: NOW,
    updatedAt: NOW,
    theme: {
      id: 'benchmark-default',
      name: 'Benchmark Default',
      background: '#ffffff',
      branchColors: ['#2563eb', '#16a34a', '#dc2626'],
      textColor: '#1f2937',
      lineColor: '#94a3b8',
      fontFamily: 'system-ui, sans-serif'
    },
    sheets,
    assets: [],
    interop: {
      migratedFrom: { schemaVersion: 1 }
    }
  }
}

/** Serialize with a trailing newline and 2-space indent. */
function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeJson(filename, value) {
  await writeFile(join(OUT_DIR, filename), jsonText(value), 'utf8')
}

/** Build the .xmind ZIP bytes for a given content.json array. */
function zipWithContent(contentArray, extra = {}) {
  return zipSync({
    'content.json': strToU8(JSON.stringify(contentArray)),
    'metadata.json': strToU8('{"creator":{"name":"StudiumX","version":"benchmark"}}'),
    'manifest.json': strToU8('{"file-entries":{"content.json":{}}}'),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)]))
  })
}

async function writeBytes(filename, bytes) {
  await writeFile(join(OUT_DIR, filename), bytes)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  // ---- v2 benchmark documents -------------------------------------------
  const docSpecs = [
    { nodeCount: 10, minDepth: 3, maxDepth: 3, withElements: false, seed: SEED + 1 },
    { nodeCount: 100, minDepth: 4, maxDepth: 5, withElements: false, seed: SEED + 2 },
    { nodeCount: 500, minDepth: 5, maxDepth: 7, withElements: true, seed: SEED + 3 },
    { nodeCount: 2000, minDepth: 7, maxDepth: 10, withElements: true, seed: SEED + 4 }
  ]

  for (const spec of docSpecs) {
    const { nodeCount } = spec
    // For 2000 the fixture is split across two sheets (1900 + 100) so the
    // multi-sheet axis is also covered while the total stays exactly 2000.
    const primaryCount = nodeCount >= 2000 ? nodeCount - 100 : nodeCount
    const tree = generateTree(primaryCount, {
      minDepth: spec.minDepth,
      maxDepth: spec.maxDepth,
      idPrefix: `s1`,
      seed: spec.seed
    })
    if (primaryCount >= 100) applyCollapsed(tree, primaryCount >= 2000 ? 4 : 5)

    const sheets = [buildSheet('s1', 'Sheet 1', tree, { withElements: spec.withElements })]

    if (nodeCount >= 2000) {
      // XL: add a second smaller sheet so the fixture also covers multi-sheet.
      const secondCount = nodeCount - primaryCount
      const second = generateTree(secondCount, {
        minDepth: 4,
        maxDepth: 6,
        idPrefix: 's2',
        seed: spec.seed + 100
      })
      applyCollapsed(second, 4)
      sheets.push(buildSheet('s2', 'Sheet 2', second, { withElements: true }))
    }

    const doc = buildV2Document({
      id: `benchmark-doc-${nodeCount}-nodes-v2`,
      title: `${nodeCount} 节点基准导图 (v2)`,
      sheets
    })
    await writeJson(`doc-${nodeCount}-nodes.v2.json`, doc)
    process.stdout.write(`doc-${nodeCount}-nodes.v2.json   total nodes=${sheets.reduce((sum, s) => sum + countNodes(s.root), 0)}\n`)
  }

  // ---- XMind content.json fixtures ---------------------------------------
  const basicContent = [
    {
      class: 'sheet',
      id: 'xmind-sheet-basic',
      title: 'Sheet 1',
      structureClass: 'org.xmind.ui.logic.right',
      rootTopic: {
        class: 'topic',
        id: 't1',
        title: '中心主题',
        children: {
          attached: [
            {
              class: 'topic',
              id: 't2',
              title: '分支 A',
              children: {
                attached: [
                  { class: 'topic', id: 't3', title: 'A1' },
                  { class: 'topic', id: 't4', title: 'A2' }
                ]
              }
            },
            { class: 'topic', id: 't5', title: '分支 B' }
          ]
        }
      }
    }
  ]

  const structureVariants = [
    ['right', 'org.xmind.ui.logic.right'],
    ['balanced', 'org.xmind.ui.logic.balanced'],
    ['map', 'org.xmind.ui.logic.map'],
    ['down', 'org.xmind.ui.logic.down'],
    ['up', 'org.xmind.ui.logic.up']
  ]

  for (const [slug, structureClass] of structureVariants) {
    const content = [
      {
        class: 'sheet',
        id: `xmind-sheet-${slug}`,
        title: `${slug} sheet`,
        structureClass,
        rootTopic: {
          class: 'topic',
          id: 't1',
          title: '中心主题',
          children: {
            attached: [
              { class: 'topic', id: 't2', title: '分支 A' },
              { class: 'topic', id: 't3', title: '分支 B' }
            ]
          }
        }
      }
    ]
    await writeJson(`xmind-content-${slug}.json`, content)
  }

  const stylesContent = [
    {
      class: 'sheet',
      id: 'xmind-sheet-styles',
      title: '带样式的 Sheet',
      structureClass: 'org.xmind.ui.logic.map',
      theme: {
        id: 'benchmark-theme',
        name: 'Benchmark Theme',
        background: '#ffffff'
      },
      rootTopic: {
        class: 'topic',
        id: 't1',
        title: 'Root',
        style: { fill: '#dbeafe', 'line-color': '#2563eb', shape: 'rounded-rect' },
        children: {
          attached: [
            {
              class: 'topic',
              id: 't2',
              title: '样式分支',
              style: { fill: '#dcfce7', 'font-weight': 'bold' }
            }
          ]
        }
      }
    }
  ]
  await writeJson('xmind-content-styles.json', stylesContent)

  const relationshipsContent = [
    {
      class: 'sheet',
      id: 'xmind-sheet-relationships',
      title: '关系线 Sheet',
      structureClass: 'org.xmind.ui.logic.right',
      rootTopic: {
        class: 'topic',
        id: 't1',
        title: 'Root',
        children: {
          attached: [
            { class: 'topic', id: 't2', title: '节点 A' },
            { class: 'topic', id: 't3', title: '节点 B' }
          ]
        }
      },
      relationships: [
        { id: 'rel-1', title: '依赖', end1Id: 't1', end2Id: 't2' },
        { id: 'rel-2', title: '引用', end1Id: 't2', end2Id: 't3' }
      ]
    }
  ]
  await writeJson('xmind-content-relationships.json', relationshipsContent)

  const summariesContent = [
    {
      class: 'sheet',
      id: 'xmind-sheet-summaries',
      title: '概要 Sheet',
      structureClass: 'org.xmind.ui.logic.down',
      rootTopic: {
        class: 'topic',
        id: 't1',
        title: 'Root',
        children: {
          attached: [
            { class: 'topic', id: 't2', title: 'A' },
            { class: 'topic', id: 't3', title: 'B' },
            { class: 'topic', id: 't4', title: 'C' }
          ]
        }
      },
      summaries: [
        { id: 'sum-1', title: 'A–B 总结', range: { startId: 't2', endId: 't3' } }
      ]
    }
  ]
  await writeJson('xmind-content-summaries.json', summariesContent)

  const attachmentsContent = [
    {
      class: 'sheet',
      id: 'xmind-sheet-attachments',
      title: '附件 Sheet',
      structureClass: 'org.xmind.ui.logic.right',
      rootTopic: {
        class: 'topic',
        id: 't1',
        title: 'Root',
        children: {
          attached: [
            {
              class: 'topic',
              id: 't2',
              title: '带图片',
              image: { src: 'attachments/diagram.png', width: 320, height: 200 }
            },
            {
              class: 'topic',
              id: 't3',
              title: '带附件',
              attachment: { filePath: 'attachments/lesson.pdf', size: 4096 }
            }
          ]
        }
      }
    }
  ]
  await writeJson('xmind-content-attachments.json', attachmentsContent)

  const unknownContent = [
    {
      class: 'sheet',
      id: 'xmind-sheet-unknown',
      title: '未知字段 Sheet',
      structureClass: 'org.xmind.ui.logic.right',
      rootTopic: {
        class: 'topic',
        id: 't1',
        title: 'Root',
        'x-custom-field': { nested: { value: 42 } },
        children: {
          attached: [
            {
              class: 'topic',
              id: 't2',
              title: '分支',
              'some-future-key': 'future-value'
            }
          ]
        }
      },
      'x-sheet-extension': { note: 'unknown sheet field' }
    }
  ]
  await writeJson('xmind-content-unknown-fields.json', unknownContent)

  const emptyContent = [
    {
      class: 'sheet',
      id: 'xmind-sheet-empty',
      title: '空 Sheet',
      rootTopic: { class: 'topic', id: 't1', title: 'Root' }
    }
  ]
  await writeJson('xmind-content-empty.json', emptyContent)

  const multiSheetContent = [
    {
      class: 'sheet',
      id: 'xmind-sheet-multi-1',
      title: 'Sheet 1',
      structureClass: 'org.xmind.ui.logic.right',
      rootTopic: { class: 'topic', id: 't1', title: 'Root 1' }
    },
    {
      class: 'sheet',
      id: 'xmind-sheet-multi-2',
      title: 'Sheet 2',
      structureClass: 'org.xmind.ui.logic.balanced',
      rootTopic: { class: 'topic', id: 't2', title: 'Root 2' }
    }
  ]
  await writeJson('xmind-content-multi-sheet.json', multiSheetContent)

  // Existing representative fixtures are kept for compat; regenerate a copy of
  // the basic one so the generator is the single source for the matrix.
  await writeJson('xmind-content-basic.json', basicContent)

  // ---- corrupted .xmind ZIP fixtures -------------------------------------
  // Each is a real file (not a mock string) so the test loads real bytes.
  await writeBytes('xmind-corrupt-not-a-zip.xmind', strToU8('this is not a zip archive at all'))
  await writeBytes('xmind-corrupt-empty.xmind', new Uint8Array(0))
  await writeBytes('xmind-corrupt-missing-content.xmind', zipSync({ 'metadata.json': strToU8('{}') }))
  await writeBytes('xmind-corrupt-invalid-json.xmind', zipSync({ 'content.json': strToU8('not json at all') }))
  const truncatableZip = zipWithContent([basicContent[0]])
  await writeBytes('xmind-corrupt-truncated.xmind', truncatableZip.slice(0, Math.max(0, truncatableZip.length - 24)))

  process.stdout.write('fixtures regenerated successfully\n')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

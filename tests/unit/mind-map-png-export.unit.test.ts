import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { exportMindMapPngFile } from '../../src/main/mindmap/png-file'
import { parseMindMapPngExportPayload } from '../../src/main/mindmap/mind-map-ipc-commands'
import {
  getMindMapSvgExportDimensions,
  type MindMapSvgExportInput
} from '../../src/shared/mindmap/svg-export'
import { inspectMindMapPngExportArtifact } from '../../src/shared/mindmap/png-export'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function sampleInput(): MindMapSvgExportInput {
  return {
    title: 'PNG contract',
    nodes: [{ id: 'root', title: 'Root', x: 0, y: 0, width: 1, height: 1 }],
    edges: []
  }
}

function pngArtifact(input = sampleInput()): {
  pngBase64: string
  width: number
  height: number
} {
  const { width, height } = getMindMapSvgExportDimensions(input)
  return {
    pngBase64: makePng(width, height).toString('base64'),
    width,
    height
  }
}

function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const row = Buffer.alloc(width * 4 + 1)
  row[0] = 0 // no filter
  for (let pixel = 0; pixel < width; pixel += 1) row[pixel * 4 + 4] = 255
  const pixels = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBytes, data])
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  body.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(body), 8 + data.length)
  return chunk
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function replaceBase64Byte(base64: string, offset: number): string {
  const bytes = Buffer.from(base64, 'base64')
  bytes[offset] = bytes[offset]! ^ 0xff
  return bytes.toString('base64')
}

describe('mind-map PNG export contract', () => {
  it('accepts a real bounded PNG artifact and writes it with a safe filename', async () => {
    const input = sampleInput()
    const artifact = pngArtifact(input)
    expect(inspectMindMapPngExportArtifact(artifact, artifact)).toMatchObject({
      width: artifact.width,
      height: artifact.height,
      byteLength: expect.any(Number)
    })

    const destination = await mkdtemp(join(tmpdir(), 'studiumx-mindmap-png-'))
    const result = await exportMindMapPngFile(
      { title: 'Cell Biology / PNG', ...artifact },
      destination,
      artifact
    )
    expect(result.path).toBe(join(destination, 'cell-biology-png.png'))
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from(artifact.pngBase64, 'base64'))
  })

  it('rejects malformed, tampered, oversized, and layout-mismatched artifacts', () => {
    const input = sampleInput()
    const artifact = pngArtifact(input)

    expect(() =>
      inspectMindMapPngExportArtifact({
        ...artifact,
        pngBase64: replaceBase64Byte(artifact.pngBase64, 0)
      })
    ).toThrow(/signature/i)
    expect(() =>
      inspectMindMapPngExportArtifact({
        ...artifact,
        pngBase64: replaceBase64Byte(artifact.pngBase64, 29)
      })
    ).toThrow(/checksum/i)
    expect(() =>
      inspectMindMapPngExportArtifact({
        ...artifact,
        pngBase64: `${artifact.pngBase64}AAAA`
      })
    ).toThrow(/base64|trailing/i)
    expect(() =>
      inspectMindMapPngExportArtifact({ ...artifact, width: artifact.width + 1 })
    ).toThrow(/dimensions/i)
    expect(() =>
      inspectMindMapPngExportArtifact({
        ...artifact,
        width: 8_193,
        height: 1
      })
    ).toThrow(/safety limit/i)
  })

  it('requires exact IPC fields and binds PNG dimensions to the validated layout', () => {
    const input = sampleInput()
    const artifact = pngArtifact(input)
    const valid = {
      workspaceId: 'workspace-1',
      id: 'map-1',
      sheetId: 'sheet-1',
      destinationDirectory: '/tmp/exports',
      input,
      ...artifact,
      snapshotRevision: 4,
      expectedRevision: 4,
      pendingWrites: false,
      dirty: false
    }

    expect(parseMindMapPngExportPayload(valid)).toEqual(valid)
    expect(parseMindMapPngExportPayload({ ...valid, extra: true })).toBeNull()
    expect(parseMindMapPngExportPayload({ ...valid, width: valid.width + 1 })).toBeNull()
    expect(
      parseMindMapPngExportPayload({
        ...valid,
        pngBase64: replaceBase64Byte(valid.pngBase64, 29)
      })
    ).toBeNull()
  })
})

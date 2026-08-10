/**
 * Browser-side rasterization for PNG mind-map export.
 *
 * SVG is serialized through the same shared, static serializer used by the
 * main process.  The browser canvas is the only image codec available in the
 * renderer; the resulting PNG bytes cross IPC as bounded base64 and are
 * validated again by the main process before writing.
 */
import {
  getMindMapSvgExportDimensions,
  serializeMindMapSvg,
  type MindMapSvgExportInput
} from '../../../../shared/mindmap/svg-export'
import {
  MIND_MAP_PNG_EXPORT_LIMITS,
  type MindMapPngExportArtifact
} from '../../../../shared/mindmap/png-export'

export async function rasterizeMindMapSvgToPng(
  input: MindMapSvgExportInput
): Promise<MindMapPngExportArtifact> {
  const dimensions = getMindMapSvgExportDimensions(input)
  if (
    dimensions.width > MIND_MAP_PNG_EXPORT_LIMITS.maxWidth ||
    dimensions.height > MIND_MAP_PNG_EXPORT_LIMITS.maxHeight ||
    dimensions.width * dimensions.height > MIND_MAP_PNG_EXPORT_LIMITS.maxPixels
  ) {
    throw new Error('PNG export dimensions exceed the safety limit')
  }

  const svg = serializeMindMapSvg(input)
  const image = new Image()
  const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    await loadImage(image, sourceUrl)
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('PNG export could not create a 2D canvas')
    context.clearRect(0, 0, dimensions.width, dimensions.height)
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    const blob = await canvasToPngBlob(canvas)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.byteLength > MIND_MAP_PNG_EXPORT_LIMITS.maxBytes) {
      throw new Error('PNG export artifact exceeds the byte safety limit')
    }
    return {
      pngBase64: bytesToBase64(bytes),
      width: dimensions.width,
      height: dimensions.height
    }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function loadImage(image: HTMLImageElement, sourceUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('PNG export could not rasterize the SVG layout'))
    image.src = sourceUrl
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG export could not encode the canvas'))
        return
      }
      resolve(blob)
    }, 'image/png')
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

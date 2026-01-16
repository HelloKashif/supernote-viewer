/**
 * Renderer for Supernote .mark annotation layers
 * Uses the same RLE decoding as .note files
 */

import { MarkFile, MarkPage, getAnnotationDimensions, parseTotalPath } from './mark-parser';
import { inflate } from 'pako';

// RLE color codes (same as .note files)
const COLORCODE_BLACK = 0x61;
const COLORCODE_BACKGROUND = 0x62;
const COLORCODE_DARK_GRAY = 0x63;
const COLORCODE_GRAY = 0x64;
const COLORCODE_WHITE = 0x65;
const COLORCODE_MARKER_BLACK = 0x66;
const COLORCODE_MARKER_DARK_GRAY = 0x67;
const COLORCODE_MARKER_GRAY = 0x68;

// For X2 devices
const COLORCODE_MARKER_DARK_GRAY_X2 = 0x9e;
const COLORCODE_MARKER_GRAY_X2 = 0xca;

const SPECIAL_LENGTH_MARKER = 0xff;
const SPECIAL_LENGTH = 0x4000;

// Color mapping: [R, G, B, A]
// For annotations, we want transparent background
const ANNOTATION_COLORS: Record<number, [number, number, number, number]> = {
  [COLORCODE_BLACK]: [0, 0, 0, 255],
  [COLORCODE_BACKGROUND]: [0, 0, 0, 0], // Transparent!
  [COLORCODE_DARK_GRAY]: [100, 100, 100, 255],
  [COLORCODE_GRAY]: [180, 180, 180, 255],
  [COLORCODE_WHITE]: [255, 255, 255, 255],
  [COLORCODE_MARKER_BLACK]: [0, 0, 0, 200],
  [COLORCODE_MARKER_DARK_GRAY]: [100, 100, 100, 180],
  [COLORCODE_MARKER_GRAY]: [180, 180, 180, 150],
  [COLORCODE_MARKER_DARK_GRAY_X2]: [100, 100, 100, 180],
  [COLORCODE_MARKER_GRAY_X2]: [180, 180, 180, 150],
};

function decodeRle(data: Uint8Array, width: number, height: number): ImageData {
  const pixels = new Uint8ClampedArray(width * height * 4);
  let pixelIndex = 0;
  let dataIndex = 0;

  // Fill with transparent initially
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
    pixels[i + 3] = 0;
  }

  while (dataIndex < data.length && pixelIndex < width * height) {
    const colorCode = data[dataIndex++];
    if (dataIndex >= data.length) break;

    let length = data[dataIndex++];

    if (length === SPECIAL_LENGTH_MARKER) {
      length = SPECIAL_LENGTH;
    }

    const color = ANNOTATION_COLORS[colorCode] || [255, 0, 255, 255]; // Magenta for unknown

    for (let i = 0; i < length && pixelIndex < width * height; i++) {
      const idx = pixelIndex * 4;
      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
      pixels[idx + 3] = color[3];
      pixelIndex++;
    }
  }

  return new ImageData(pixels, width, height);
}

/**
 * Render annotation layer for a specific page
 */
export function renderAnnotationLayer(
  mark: MarkFile,
  pageNumber: number
): ImageData | null {
  // Find the page with matching page number
  const page = mark.pages.find(p => p.pageNumber === pageNumber);
  if (!page || page.layers.length === 0) {
    return null; // No annotations for this page
  }

  // Try to get dimensions from the first layer's TOTALPATH
  let dims = getAnnotationDimensions(mark.equipment);
  console.log(`[mark-renderer] Equipment: ${mark.equipment}, default dims: ${dims.width}x${dims.height}`);

  for (const layer of page.layers) {
    console.log(`[mark-renderer] Layer ${layer.name}, totalPath: ${layer.totalPath}`);
    const layerDims = parseTotalPath(layer.totalPath);
    if (layerDims) {
      console.log(`[mark-renderer] Parsed dims from TOTALPATH: ${layerDims.width}x${layerDims.height}`);
      dims = layerDims;
      break;
    }
  }

  console.log(`[mark-renderer] Using dims: ${dims.width}x${dims.height}`);

  // Create composite canvas for all layers
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d')!;

  // Render each layer (composite them)
  for (const layer of page.layers) {
    if (!layer.bitmapData || layer.protocol !== 'RATTA_RLE') continue;

    // Get layer-specific dimensions if available
    const layerDims = parseTotalPath(layer.totalPath) || dims;

    try {
      // Try to decompress the data first (it might be zlib compressed)
      let bitmapData = layer.bitmapData;
      try {
        const decompressed = inflate(layer.bitmapData);
        console.log(`[mark-renderer] Decompressed ${layer.bitmapData.length} -> ${decompressed.length} bytes`);
        bitmapData = decompressed;
      } catch (e) {
        // Not compressed, use raw data
        console.log(`[mark-renderer] Data not compressed, using raw (${layer.bitmapData.length} bytes)`);
      }

      const imageData = decodeRle(bitmapData, layerDims.width, layerDims.height);

      // Create temp canvas for this layer
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = layerDims.width;
      tempCanvas.height = layerDims.height;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.putImageData(imageData, 0, 0);

      // Composite onto main canvas (scale if needed)
      ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height);
    } catch (error) {
      console.error(`Error rendering layer ${layer.name}:`, error);
    }
  }

  return ctx.getImageData(0, 0, dims.width, dims.height);
}

/**
 * Convert ImageData to a data URL with transparency
 */
export function annotationToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Get all page numbers that have annotations
 */
export function getAnnotatedPageNumbers(mark: MarkFile): number[] {
  return mark.pages.map(p => p.pageNumber);
}

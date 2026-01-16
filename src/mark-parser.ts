/**
 * Parser for Supernote .mark files (PDF annotation overlay)
 * .mark files have the same format as .note files
 */

import { inflate } from 'pako';

export interface MarkFile {
  signature: string;
  fileType: string;
  equipment: string;
  pages: MarkPage[];
}

export interface MarkPage {
  pageNumber: number;  // 1-indexed PDF page number
  layers: MarkLayer[];
}

export interface MarkLayer {
  name: string;
  protocol: string;
  bitmapData: Uint8Array | null;
  totalPath: string | null;  // Contains dimension info
}

const LENGTH_FIELD_SIZE = 4;

function readUint32LE(buffer: Uint8Array, offset: number): number {
  return buffer[offset] |
         (buffer[offset + 1] << 8) |
         (buffer[offset + 2] << 16) |
         (buffer[offset + 3] << 24) >>> 0;
}

function extractParameters(content: string): Record<string, string | string[]> {
  const pattern = /<([^:<>]+):(.*?)>/g;
  const params: Record<string, string | string[]> = {};
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const key = match[1];
    const value = match[2];

    if (params[key]) {
      if (!Array.isArray(params[key])) {
        params[key] = [params[key] as string, value];
      } else {
        (params[key] as string[]).push(value);
      }
    } else {
      params[key] = value;
    }
  }

  return params;
}

function readBlock(buffer: Uint8Array, address: number): string {
  if (address === 0) return '';
  const length = readUint32LE(buffer, address);
  const content = buffer.slice(address + LENGTH_FIELD_SIZE, address + LENGTH_FIELD_SIZE + length);
  return new TextDecoder().decode(content);
}

function readBinaryBlock(buffer: Uint8Array, address: number): Uint8Array | null {
  if (address === 0) return null;
  const length = readUint32LE(buffer, address);
  return buffer.slice(address + LENGTH_FIELD_SIZE, address + LENGTH_FIELD_SIZE + length);
}

export function parseMarkFile(buffer: Uint8Array): MarkFile {
  // Read file type (first 4 bytes)
  const fileType = new TextDecoder().decode(buffer.slice(0, 4));
  if (fileType !== 'mark') {
    throw new Error(`Invalid .mark file: expected 'mark', got '${fileType}'`);
  }

  // Read signature (bytes 4-24)
  const signature = new TextDecoder().decode(buffer.slice(4, 24));

  // Read footer address (last 4 bytes)
  const footerAddress = readUint32LE(buffer, buffer.length - 4);

  // Parse footer
  const footerContent = readBlock(buffer, footerAddress);
  const footerParams = extractParameters(footerContent);

  // Parse header
  const headerAddress = parseInt(footerParams['FILE_FEATURE'] as string || '0', 10);
  const headerContent = readBlock(buffer, headerAddress);
  const headerParams = extractParameters(headerContent);

  const equipment = headerParams['APPLY_EQUIPMENT'] as string || 'unknown';

  // Find all page addresses
  const pageAddresses: { pageNum: number; address: number }[] = [];
  for (const key of Object.keys(footerParams)) {
    if (key.startsWith('PAGE')) {
      const pageNum = parseInt(key.replace('PAGE', ''), 10);
      const address = parseInt(footerParams[key] as string, 10);
      pageAddresses.push({ pageNum, address });
    }
  }

  // Sort by page number
  pageAddresses.sort((a, b) => a.pageNum - b.pageNum);

  // Parse each page
  const pages: MarkPage[] = [];
  for (const { pageNum, address } of pageAddresses) {
    const pageContent = readBlock(buffer, address);
    const pageParams = extractParameters(pageContent);

    const layers: MarkLayer[] = [];

    // Parse MAINLAYER
    const mainLayerAddress = parseInt(pageParams['MAINLAYER'] as string || '0', 10);
    if (mainLayerAddress > 0) {
      const layerContent = readBlock(buffer, mainLayerAddress);
      const layerParams = extractParameters(layerContent);

      const bitmapAddress = parseInt(layerParams['LAYERBITMAP'] as string || '0', 10);
      const bitmapData = readBinaryBlock(buffer, bitmapAddress);

      layers.push({
        name: layerParams['LAYERNAME'] as string || 'MAINLAYER',
        protocol: layerParams['LAYERPROTOCOL'] as string || 'RATTA_RLE',
        bitmapData,
        totalPath: layerParams['TOTALPATH'] as string || null,
      });
    }

    // Parse additional layers (LAYER1, LAYER2, LAYER3, BGLAYER)
    for (const layerKey of ['LAYER1', 'LAYER2', 'LAYER3', 'BGLAYER']) {
      const layerAddress = parseInt(pageParams[layerKey] as string || '0', 10);
      if (layerAddress > 0) {
        const layerContent = readBlock(buffer, layerAddress);
        const layerParams = extractParameters(layerContent);

        const bitmapAddress = parseInt(layerParams['LAYERBITMAP'] as string || '0', 10);
        const bitmapData = readBinaryBlock(buffer, bitmapAddress);

        if (bitmapData) {
          layers.push({
            name: layerParams['LAYERNAME'] as string || layerKey,
            protocol: layerParams['LAYERPROTOCOL'] as string || 'RATTA_RLE',
            bitmapData,
            totalPath: layerParams['TOTALPATH'] as string || null,
          });
        }
      }
    }

    pages.push({
      pageNumber: pageNum,
      layers,
    });
  }

  return {
    signature,
    fileType,
    equipment,
    pages,
  };
}

// Parse dimensions from TOTALPATH string (format: "c x y width height" or similar)
export function parseTotalPath(totalPath: string | null): { width: number; height: number } | null {
  if (!totalPath) return null;

  // TOTALPATH format examples: "c 0 0 1404 1872" or just coordinates
  const parts = totalPath.trim().split(/\s+/);

  // Try to find width and height (last two numbers)
  const numbers = parts.filter(p => /^\d+$/.test(p)).map(Number);

  if (numbers.length >= 2) {
    // Last two numbers are typically width and height
    const width = numbers[numbers.length - 2];
    const height = numbers[numbers.length - 1];
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return null;
}

// Annotation dimensions based on device
export function getAnnotationDimensions(equipment: string): { width: number; height: number } {
  // Standard Supernote dimensions
  // A5X/A5X2: 1404 x 1872
  // A6X/A6X2 (N6): 1404 x 1872 (Nomad uses same aspect ratio)
  return { width: 1404, height: 1872 };
}

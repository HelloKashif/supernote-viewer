/*
Supernote Viewer - Simple .note file viewer for Obsidian
*/
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SupernoteViewerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/parser.ts
var ADDRESS_SIZE = 4;
var LENGTH_FIELD_SIZE = 4;
function readUint32LE(data, offset) {
  return (data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24) >>> 0;
}
function getContentAtAddress(buffer, address) {
  if (address === 0)
    return null;
  const blockLength = readUint32LE(buffer, address);
  return buffer.subarray(address + LENGTH_FIELD_SIZE, address + LENGTH_FIELD_SIZE + blockLength);
}
function uint8ArrayToString(arr) {
  return new TextDecoder("utf-8").decode(arr);
}
function extractKeyValue(content) {
  const pattern = /<([^:<>]+):([^:<>]+)>/gm;
  const pairs = [...content.matchAll(pattern)];
  const data = {};
  for (const [, key, value] of pairs) {
    if (key in data) {
      const existing = data[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        data[key] = [existing, value];
      }
    } else {
      data[key] = value;
    }
  }
  return data;
}
function parseKeyValue(buffer, address) {
  const content = getContentAtAddress(buffer, address);
  if (content === null)
    return {};
  return extractKeyValue(uint8ArrayToString(content));
}
function extractNestedKeyValue(record, delimiter = "_", prefixes = []) {
  const data = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string")
      continue;
    let main;
    let sub;
    const idx = key.indexOf(delimiter);
    if (idx > -1) {
      main = key.substring(0, idx);
      sub = key.substring(idx + 1);
    } else {
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) {
          main = prefix;
          sub = key.substring(main.length);
          break;
        }
      }
    }
    if (main && sub) {
      if (main in data) {
        data[main][sub] = value;
      } else {
        data[main] = { [sub]: value };
      }
    }
  }
  return data;
}
function parseSupernoteFile(buffer) {
  var _a;
  const signatureContent = uint8ArrayToString(buffer.subarray(0, 24));
  const signatureMatch = signatureContent.match(/^noteSN_FILE_VER_(\d{8})/);
  if (!signatureMatch) {
    throw new Error("Invalid Supernote file: signature doesn't match");
  }
  const signature = signatureContent;
  const version = parseInt(signatureMatch[1]);
  const footerAddressChunk = buffer.subarray(buffer.length - ADDRESS_SIZE);
  const footerAddress = readUint32LE(footerAddressChunk, 0);
  const footerData = parseKeyValue(buffer, footerAddress);
  const footer = extractNestedKeyValue(footerData, "_", ["PAGE"]);
  const headerAddress = ((_a = footer.FILE) == null ? void 0 : _a.FEATURE) ? parseInt(footer.FILE.FEATURE) : 24;
  const headerData = parseKeyValue(buffer, headerAddress);
  const equipment = headerData.APPLY_EQUIPMENT || "unknown";
  let pageWidth = 1404;
  let pageHeight = 1872;
  if (equipment === "N5") {
    pageWidth = 1920;
    pageHeight = 2560;
  }
  const pageAddresses = footer.PAGE || {};
  const pageIndices = Object.keys(pageAddresses).sort((a, b) => {
    return parseInt(a) - parseInt(b);
  });
  const pages = pageIndices.map((idx) => {
    const pageAddress = parseInt(pageAddresses[idx]);
    const pageData = parseKeyValue(buffer, pageAddress);
    const layerSequence = (pageData.LAYERSEQ || "MAINLAYER").split(",");
    const layers = [];
    const layerNames = ["MAINLAYER", "LAYER1", "LAYER2", "LAYER3", "BGLAYER"];
    for (const layerName of layerNames) {
      const layerAddress = parseInt(pageData[layerName] || "0");
      if (layerAddress === 0) {
        layers.push({ name: layerName, protocol: "", bitmapData: null });
        continue;
      }
      const layerData = parseKeyValue(buffer, layerAddress);
      const bitmapAddress = parseInt(layerData.LAYERBITMAP || "0");
      const bitmapData = getContentAtAddress(buffer, bitmapAddress);
      layers.push({
        name: layerName,
        protocol: layerData.LAYERPROTOCOL || "RATTA_RLE",
        bitmapData
      });
    }
    return { layers, layerSequence };
  });
  return {
    signature,
    version,
    pageWidth,
    pageHeight,
    equipment,
    pages
  };
}

// src/renderer.ts
var ENCODED_COLORS = {
  97: [0, 0, 0, 255],
  // black
  98: [255, 255, 255, 0],
  // background (transparent)
  99: [169, 169, 169, 255],
  // darkGray
  100: [128, 128, 128, 255],
  // gray
  101: [255, 255, 255, 255],
  // white
  102: [0, 0, 0, 255],
  // markerBlack
  103: [169, 169, 169, 255],
  // markerDarkGray
  104: [128, 128, 128, 255],
  // markerGray
  157: [169, 169, 169, 255],
  // darkGrayX2
  201: [128, 128, 128, 255],
  // grayX2
  158: [169, 169, 169, 255],
  // markerDarkGrayX2
  202: [128, 128, 128, 255]
  // markerGrayX2
};
var SPECIAL_LENGTH_MARKER = 255;
var SPECIAL_LENGTH = 16384;
function decodeRLE(buffer, width, height) {
  const expectedLength = width * height * 4;
  const result = new Uint8Array(expectedLength);
  let resultOffset = 0;
  let holder = null;
  for (let i = 1; i < buffer.length; i += 2) {
    let color = buffer[i - 1];
    let length = buffer[i];
    if (holder !== null) {
      const [prevColor, prevLength] = holder;
      holder = null;
      if (color === prevColor) {
        length = 1 + length + ((prevLength & 127) + 1 << 7);
        writePixels(result, resultOffset, color, length);
        resultOffset += length * 4;
        continue;
      } else {
        const adjustedLength = (prevLength & 127) + 1 << 7;
        writePixels(result, resultOffset, prevColor, adjustedLength);
        resultOffset += adjustedLength * 4;
      }
    }
    if (length === SPECIAL_LENGTH_MARKER) {
      length = SPECIAL_LENGTH;
      writePixels(result, resultOffset, color, length);
      resultOffset += length * 4;
    } else if ((length & 128) !== 0) {
      holder = [color, length];
    } else {
      length += 1;
      writePixels(result, resultOffset, color, length);
      resultOffset += length * 4;
    }
  }
  if (holder !== null) {
    const [color, length] = holder;
    const gap = expectedLength - resultOffset;
    let adjustedLength = 0;
    for (let i = 7; i >= 0; i--) {
      const testLength = (length & 127) + 1 << i;
      if (testLength * 4 <= gap) {
        adjustedLength = testLength;
        break;
      }
    }
    if (adjustedLength > 0) {
      writePixels(result, resultOffset, color, adjustedLength);
    }
  }
  return result;
}
function writePixels(result, offset, encodedColor, count) {
  const rgba = ENCODED_COLORS[encodedColor] || [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const idx = offset + i * 4;
    if (idx + 3 < result.length) {
      result[idx] = rgba[0];
      result[idx + 1] = rgba[1];
      result[idx + 2] = rgba[2];
      result[idx + 3] = rgba[3];
    }
  }
}
function renderPage(note, pageIndex) {
  if (pageIndex >= note.pages.length)
    return null;
  const page = note.pages[pageIndex];
  const { pageWidth, pageHeight } = note;
  const outputData = new Uint8Array(pageWidth * pageHeight * 4);
  for (let i = 0; i < outputData.length; i += 4) {
    outputData[i] = 255;
    outputData[i + 1] = 255;
    outputData[i + 2] = 255;
    outputData[i + 3] = 255;
  }
  const layersToRender = page.layerSequence.map((name) => page.layers.find((l) => l.name === name)).filter((l) => l !== void 0 && l.bitmapData !== null).reverse();
  for (const layer of layersToRender) {
    if (!layer.bitmapData || layer.bitmapData.length === 0)
      continue;
    try {
      const layerData = decodeRLE(layer.bitmapData, pageWidth, pageHeight);
      for (let i = 0; i < layerData.length; i += 4) {
        const srcA = layerData[i + 3];
        if (srcA === 0)
          continue;
        if (srcA === 255) {
          outputData[i] = layerData[i];
          outputData[i + 1] = layerData[i + 1];
          outputData[i + 2] = layerData[i + 2];
          outputData[i + 3] = 255;
        } else {
          const dstA = outputData[i + 3];
          const outA = srcA + dstA * (1 - srcA / 255);
          if (outA > 0) {
            outputData[i] = (layerData[i] * srcA + outputData[i] * dstA * (1 - srcA / 255)) / outA;
            outputData[i + 1] = (layerData[i + 1] * srcA + outputData[i + 1] * dstA * (1 - srcA / 255)) / outA;
            outputData[i + 2] = (layerData[i + 2] * srcA + outputData[i + 2] * dstA * (1 - srcA / 255)) / outA;
            outputData[i + 3] = outA;
          }
        }
      }
    } catch (e) {
      console.error(`Error decoding layer ${layer.name}:`, e);
    }
  }
  for (let i = 0; i < outputData.length; i += 4) {
    const gray = Math.round(
      outputData[i] * 0.299 + outputData[i + 1] * 0.587 + outputData[i + 2] * 0.114
    );
    outputData[i] = gray;
    outputData[i + 1] = gray;
    outputData[i + 2] = gray;
  }
  return new ImageData(
    new Uint8ClampedArray(outputData.buffer),
    pageWidth,
    pageHeight
  );
}
function imageDataToDataUrl(imageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error("Could not get canvas context");
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// src/main.ts
var VIEW_TYPE_SUPERNOTE = "supernote-viewer";
var SupernoteView = class extends import_obsidian.FileView {
  constructor(leaf) {
    super(leaf);
    this.currentFile = null;
    this.renderedImages = [];
    // View settings
    this.viewMode = "single";
    this.fitMode = "width";
    this.pagesContainer = null;
    this.viewContent = this.containerEl.children[1];
  }
  getViewType() {
    return VIEW_TYPE_SUPERNOTE;
  }
  getDisplayText() {
    var _a;
    return ((_a = this.file) == null ? void 0 : _a.basename) || "Supernote Viewer";
  }
  async onLoadFile(file) {
    this.clearView();
    this.currentFile = file;
    const loadingEl = this.viewContent.createEl("div", {
      cls: "supernote-loading",
      text: "Loading..."
    });
    try {
      const buffer = await this.app.vault.readBinary(file);
      const data = new Uint8Array(buffer);
      const note = parseSupernoteFile(data);
      loadingEl.remove();
      this.renderToolbar(note);
      await this.renderPages(note);
    } catch (error) {
      loadingEl.remove();
      this.viewContent.createEl("div", {
        cls: "supernote-error",
        text: `Error loading file: ${error instanceof Error ? error.message : "Unknown error"}`
      });
      console.error("Supernote Viewer error:", error);
    }
  }
  clearView() {
    this.viewContent.empty();
    this.renderedImages = [];
    this.currentFile = null;
    this.pagesContainer = null;
  }
  renderToolbar(note) {
    const controls = this.viewContent.createEl("div", { cls: "supernote-floating-controls" });
    const viewModeBtn = controls.createEl("button", {
      cls: "supernote-icon-btn",
      attr: { "aria-label": "Toggle single/two-page view", "title": "Toggle view mode" }
    });
    this.updateViewModeButton(viewModeBtn);
    viewModeBtn.addEventListener("click", () => {
      this.viewMode = this.viewMode === "single" ? "two-page" : "single";
      this.updateViewModeButton(viewModeBtn);
      this.applyViewSettings();
    });
    const fitModeBtn = controls.createEl("button", {
      cls: "supernote-icon-btn",
      attr: { "aria-label": "Toggle fit width/height", "title": "Toggle fit mode" }
    });
    this.updateFitModeButton(fitModeBtn);
    fitModeBtn.addEventListener("click", () => {
      this.fitMode = this.fitMode === "width" ? "height" : "width";
      this.updateFitModeButton(fitModeBtn);
      this.applyViewSettings();
    });
  }
  updateViewModeButton(btn) {
    if (this.viewMode === "single") {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
      btn.removeClass("active");
      btn.setAttribute("title", "Single page view");
    } else {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="8" height="18" rx="1"/><rect x="14" y="3" width="8" height="18" rx="1"/></svg>';
      btn.addClass("active");
      btn.setAttribute("title", "Two-page view");
    }
  }
  updateFitModeButton(btn) {
    if (this.fitMode === "width") {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12H3M21 12l-4-4M21 12l-4 4M3 12l4-4M3 12l4 4"/></svg>';
      btn.removeClass("active");
      btn.setAttribute("title", "Fit to width");
    } else {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M12 3l-4 4M12 3l4 4M12 21l-4-4M12 21l4-4"/></svg>';
      btn.addClass("active");
      btn.setAttribute("title", "Fit to height");
    }
  }
  applyViewSettings() {
    if (!this.pagesContainer)
      return;
    this.pagesContainer.removeClass("view-single", "view-two-page");
    this.pagesContainer.addClass(`view-${this.viewMode === "single" ? "single" : "two-page"}`);
    this.pagesContainer.removeClass("fit-width", "fit-height");
    this.pagesContainer.addClass(`fit-${this.fitMode}`);
  }
  async renderPages(note) {
    this.pagesContainer = this.viewContent.createEl("div", {
      cls: `supernote-pages view-${this.viewMode === "single" ? "single" : "two-page"} fit-${this.fitMode}`
    });
    for (let i = 0; i < note.pages.length; i++) {
      if (this.currentFile !== this.file) {
        return;
      }
      const pageContainer = this.pagesContainer.createEl("div", { cls: "supernote-page" });
      const pageNumber = pageContainer.createEl("div", {
        cls: "supernote-page-number",
        text: `${i + 1}`
      });
      try {
        const imageData = renderPage(note, i);
        if (imageData) {
          const dataUrl = imageDataToDataUrl(imageData);
          this.renderedImages.push(dataUrl);
          const img = pageContainer.createEl("img", {
            cls: "supernote-page-image"
          });
          img.src = dataUrl;
          img.alt = `Page ${i + 1}`;
        }
      } catch (error) {
        pageContainer.createEl("div", {
          cls: "supernote-page-error",
          text: `Error rendering page ${i + 1}`
        });
        console.error(`Error rendering page ${i + 1}:`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  async onUnloadFile(file) {
    this.clearView();
  }
  async onClose() {
    this.clearView();
  }
};
var SupernoteViewerPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_SUPERNOTE, (leaf) => new SupernoteView(leaf));
    this.registerExtensions(["note"], VIEW_TYPE_SUPERNOTE);
    console.log("Supernote Viewer plugin loaded");
  }
  onunload() {
    console.log("Supernote Viewer plugin unloaded");
  }
};

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
var DEFAULT_SETTINGS = {
  viewMode: "single",
  fitMode: "width",
  zoomLevel: 100,
  showThumbnails: true
};
var DEFAULT_DATA = {
  settings: DEFAULT_SETTINGS,
  filePositions: {}
};
var SupernoteView = class extends import_obsidian.FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.currentFile = null;
    this.renderedImages = [];
    this.renderGeneration = 0;
    // For cancelling stale renders
    // View settings (loaded from plugin)
    this.viewMode = "single";
    this.fitMode = "width";
    this.zoomLevel = 100;
    this.showThumbnails = true;
    this.currentPage = 1;
    this.totalPages = 0;
    // DOM elements
    this.pagesContainer = null;
    this.pageElements = [];
    this.pageDisplay = null;
    this.pageInput = null;
    this.thumbnailContainer = null;
    this.thumbnailElements = [];
    this.mainContainer = null;
    this.scrollObserver = null;
    this.savePositionTimeout = null;
    this.plugin = plugin;
    this.viewContent = this.containerEl.children[1];
    this.loadSettings();
  }
  loadSettings() {
    const settings = this.plugin.getData().settings;
    this.viewMode = settings.viewMode;
    this.fitMode = settings.fitMode;
    this.zoomLevel = settings.zoomLevel;
    this.showThumbnails = settings.showThumbnails;
  }
  async saveSettings() {
    const data = this.plugin.getData();
    data.settings = {
      viewMode: this.viewMode,
      fitMode: this.fitMode,
      zoomLevel: this.zoomLevel,
      showThumbnails: this.showThumbnails
    };
    await this.plugin.saveData(data);
  }
  async saveFilePosition() {
    if (!this.file)
      return;
    const data = this.plugin.getData();
    data.filePositions[this.file.path] = this.currentPage;
    await this.plugin.saveData(data);
  }
  loadFilePosition() {
    if (!this.file)
      return 1;
    const data = this.plugin.getData();
    return data.filePositions[this.file.path] || 1;
  }
  getViewType() {
    return VIEW_TYPE_SUPERNOTE;
  }
  getDisplayText() {
    var _a;
    return ((_a = this.file) == null ? void 0 : _a.basename) || "Supernote Viewer";
  }
  async onLoadFile(file) {
    this.renderGeneration++;
    const currentGeneration = this.renderGeneration;
    this.clearView();
    this.currentFile = file;
    const savedPage = this.loadFilePosition();
    const loadingEl = this.viewContent.createEl("div", {
      cls: "supernote-loading",
      text: "Loading..."
    });
    try {
      const buffer = await this.app.vault.readBinary(file);
      if (currentGeneration !== this.renderGeneration)
        return;
      const data = new Uint8Array(buffer);
      const note = parseSupernoteFile(data);
      if (currentGeneration !== this.renderGeneration)
        return;
      this.totalPages = note.pages.length;
      this.currentPage = Math.min(savedPage, this.totalPages);
      loadingEl.remove();
      this.renderToolbar();
      this.mainContainer = this.viewContent.createEl("div", { cls: "supernote-main" });
      this.renderThumbnailSidebar();
      await this.renderPages(note, currentGeneration);
      if (currentGeneration !== this.renderGeneration)
        return;
      this.setupScrollObserver();
      if (this.currentPage > 1) {
        const pageEl = this.pageElements[this.currentPage - 1];
        if (pageEl) {
          pageEl.scrollIntoView({ behavior: "instant", block: "start" });
        }
      }
      this.updateThumbnailHighlight();
      this.populateThumbnailsAsync(currentGeneration);
    } catch (error) {
      if (currentGeneration !== this.renderGeneration)
        return;
      loadingEl.remove();
      this.viewContent.createEl("div", {
        cls: "supernote-error",
        text: `Error loading file: ${error instanceof Error ? error.message : "Unknown error"}`
      });
      console.error("Supernote Viewer error:", error);
    }
  }
  clearView() {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
      this.scrollObserver = null;
    }
    this.viewContent.empty();
    this.renderedImages = [];
    this.currentFile = null;
    this.pagesContainer = null;
    this.pageElements = [];
    this.pageDisplay = null;
    this.pageInput = null;
    this.thumbnailContainer = null;
    this.thumbnailElements = [];
    this.mainContainer = null;
  }
  renderToolbar() {
    const toolbar = this.viewContent.createEl("div", { cls: "supernote-toolbar" });
    const leftSection = toolbar.createEl("div", { cls: "supernote-toolbar-section" });
    const thumbnailBtn = leftSection.createEl("button", {
      cls: "supernote-toolbar-btn clickable-icon",
      attr: { "aria-label": "Toggle thumbnails" }
    });
    thumbnailBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect></svg>';
    thumbnailBtn.addEventListener("click", () => this.toggleThumbnails());
    const navSection = toolbar.createEl("div", { cls: "supernote-toolbar-section" });
    const prevBtn = navSection.createEl("button", {
      cls: "supernote-toolbar-btn clickable-icon",
      attr: { "aria-label": "Previous page" }
    });
    prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
    prevBtn.addEventListener("click", () => this.goToPrevPage());
    const nextBtn = navSection.createEl("button", {
      cls: "supernote-toolbar-btn clickable-icon",
      attr: { "aria-label": "Next page" }
    });
    nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    nextBtn.addEventListener("click", () => this.goToNextPage());
    this.pageDisplay = navSection.createEl("div", { cls: "supernote-page-display" });
    this.pageInput = this.pageDisplay.createEl("input", {
      cls: "supernote-page-input",
      attr: {
        type: "text",
        value: String(this.currentPage),
        "aria-label": "Go to page"
      }
    });
    this.pageInput.addEventListener("keydown", (e) => {
      var _a;
      if (e.key === "Enter") {
        this.handlePageInput();
        (_a = this.pageInput) == null ? void 0 : _a.blur();
      }
    });
    this.pageInput.addEventListener("blur", () => this.handlePageInput());
    this.pageInput.addEventListener("focus", () => {
      var _a;
      return (_a = this.pageInput) == null ? void 0 : _a.select();
    });
    this.pageDisplay.createEl("span", {
      cls: "supernote-page-total",
      text: ` of ${this.totalPages}`
    });
    const zoomSection = toolbar.createEl("div", { cls: "supernote-toolbar-section" });
    const zoomOutBtn = zoomSection.createEl("button", {
      cls: "supernote-toolbar-btn clickable-icon",
      attr: { "aria-label": "Zoom out" }
    });
    zoomOutBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>';
    zoomOutBtn.addEventListener("click", () => this.zoomOut());
    const zoomInBtn = zoomSection.createEl("button", {
      cls: "supernote-toolbar-btn clickable-icon",
      attr: { "aria-label": "Zoom in" }
    });
    zoomInBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>';
    zoomInBtn.addEventListener("click", () => this.zoomIn());
    const optionsSection = toolbar.createEl("div", { cls: "supernote-toolbar-section" });
    const optionsBtn = optionsSection.createEl("button", {
      cls: "supernote-toolbar-btn clickable-icon",
      attr: { "aria-label": "View options" }
    });
    optionsBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    optionsBtn.addEventListener("click", (e) => this.showOptionsMenu(e));
  }
  renderThumbnailSidebar() {
    if (!this.mainContainer)
      return;
    const sidebar = this.mainContainer.createEl("div", {
      cls: `supernote-sidebar ${this.showThumbnails ? "" : "hidden"}`
    });
    const resizeHandle = sidebar.createEl("div", { cls: "supernote-sidebar-resize" });
    this.setupResizeHandle(resizeHandle, sidebar);
    this.thumbnailContainer = sidebar.createEl("div", { cls: "supernote-thumbnails" });
  }
  setupResizeHandle(handle, sidebar) {
    let startX;
    let startWidth;
    const onMouseMove = (e) => {
      const newWidth = startWidth + (e.clientX - startX);
      if (newWidth >= 100 && newWidth <= 400) {
        sidebar.style.width = `${newWidth}px`;
      }
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.removeClass("supernote-resizing");
    };
    handle.addEventListener("mousedown", (e) => {
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.addClass("supernote-resizing");
    });
  }
  toggleThumbnails() {
    var _a;
    this.showThumbnails = !this.showThumbnails;
    const sidebar = (_a = this.mainContainer) == null ? void 0 : _a.querySelector(".supernote-sidebar");
    if (sidebar) {
      sidebar.toggleClass("hidden", !this.showThumbnails);
    }
    this.saveSettings();
  }
  async populateThumbnailsAsync(generation) {
    if (!this.thumbnailContainer || this.renderedImages.length === 0)
      return;
    this.thumbnailElements = [];
    for (let index = 0; index < this.renderedImages.length; index++) {
      if (generation !== this.renderGeneration)
        return;
      const thumbWrapper = this.thumbnailContainer.createEl("div", {
        cls: "supernote-thumbnail-wrapper",
        attr: { "data-page": String(index + 1) }
      });
      thumbWrapper.createEl("div", {
        cls: "supernote-thumbnail-number",
        text: String(index + 1)
      });
      thumbWrapper.addEventListener("click", () => {
        this.currentPage = index + 1;
        this.scrollToPage(this.currentPage);
        this.updatePageDisplay();
        this.updateThumbnailHighlight();
        this.saveFilePosition();
      });
      this.thumbnailElements.push(thumbWrapper);
    }
    this.updateThumbnailHighlight();
    for (let index = 0; index < this.renderedImages.length; index++) {
      if (generation !== this.renderGeneration)
        return;
      const dataUrl = this.renderedImages[index];
      const thumbWrapper = this.thumbnailElements[index];
      if (thumbWrapper && dataUrl) {
        const thumb = document.createElement("img");
        thumb.className = "supernote-thumbnail";
        thumb.src = dataUrl;
        thumb.alt = `Page ${index + 1}`;
        thumbWrapper.insertBefore(thumb, thumbWrapper.firstChild);
      }
      if (index % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  updateThumbnailHighlight() {
    this.thumbnailElements.forEach((el, index) => {
      el.toggleClass("active", index === this.currentPage - 1);
    });
    const activeThumbnail = this.thumbnailElements[this.currentPage - 1];
    if (activeThumbnail && this.thumbnailContainer) {
      activeThumbnail.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  showOptionsMenu(e) {
    const menu = new import_obsidian.Menu();
    menu.addItem((item) => {
      item.setTitle("Fit width");
      item.setChecked(this.fitMode === "width");
      item.onClick(() => {
        this.fitMode = "width";
        this.applyViewSettings();
        this.saveSettings();
      });
    });
    menu.addItem((item) => {
      item.setTitle("Fit height");
      item.setChecked(this.fitMode === "height");
      item.onClick(() => {
        this.fitMode = "height";
        this.applyViewSettings();
        this.saveSettings();
      });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("Single page");
      item.setChecked(this.viewMode === "single");
      item.onClick(() => {
        this.viewMode = "single";
        this.applyViewSettings();
        this.saveSettings();
      });
    });
    menu.addItem((item) => {
      item.setTitle("Two-page");
      item.setChecked(this.viewMode === "two-page");
      item.onClick(() => {
        this.viewMode = "two-page";
        this.applyViewSettings();
        this.saveSettings();
      });
    });
    menu.showAtMouseEvent(e);
  }
  goToPrevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.scrollToPage(this.currentPage);
      this.updatePageDisplay();
      this.updateThumbnailHighlight();
      this.saveFilePosition();
    }
  }
  goToNextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.scrollToPage(this.currentPage);
      this.updatePageDisplay();
      this.updateThumbnailHighlight();
      this.saveFilePosition();
    }
  }
  scrollToPage(pageNum) {
    const pageEl = this.pageElements[pageNum - 1];
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  updatePageDisplay() {
    if (this.pageInput) {
      this.pageInput.value = String(this.currentPage);
    }
  }
  handlePageInput() {
    if (!this.pageInput)
      return;
    const value = parseInt(this.pageInput.value, 10);
    if (!isNaN(value) && value >= 1 && value <= this.totalPages) {
      this.currentPage = value;
      this.scrollToPage(this.currentPage);
      this.updateThumbnailHighlight();
      this.saveFilePosition();
    } else {
      this.pageInput.value = String(this.currentPage);
    }
  }
  zoomIn() {
    if (this.zoomLevel < 200) {
      this.zoomLevel += 25;
      this.applyZoom();
      this.saveSettings();
    }
  }
  zoomOut() {
    if (this.zoomLevel > 50) {
      this.zoomLevel -= 25;
      this.applyZoom();
      this.saveSettings();
    }
  }
  applyZoom() {
    if (this.pagesContainer) {
      this.pagesContainer.style.setProperty("--zoom-level", `${this.zoomLevel}%`);
    }
  }
  applyViewSettings() {
    if (!this.pagesContainer)
      return;
    this.pagesContainer.removeClass("view-single", "view-two-page");
    this.pagesContainer.addClass(`view-${this.viewMode}`);
    this.pagesContainer.removeClass("fit-width", "fit-height");
    this.pagesContainer.addClass(`fit-${this.fitMode}`);
  }
  setupScrollObserver() {
    if (!this.pagesContainer)
      return;
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }
    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const pageIndex = this.pageElements.indexOf(entry.target);
            if (pageIndex !== -1) {
              this.currentPage = pageIndex + 1;
              this.updatePageDisplay();
              this.updateThumbnailHighlight();
              this.debouncedSavePosition();
            }
          }
        }
      },
      {
        root: this.pagesContainer,
        threshold: 0.5
      }
    );
    this.pageElements.forEach((el) => {
      var _a;
      return (_a = this.scrollObserver) == null ? void 0 : _a.observe(el);
    });
  }
  debouncedSavePosition() {
    if (this.savePositionTimeout) {
      window.clearTimeout(this.savePositionTimeout);
    }
    this.savePositionTimeout = window.setTimeout(() => {
      this.saveFilePosition();
    }, 500);
  }
  async renderPages(note, generation) {
    if (!this.mainContainer)
      return;
    const contentArea = this.mainContainer.createEl("div", { cls: "supernote-content" });
    this.pagesContainer = contentArea.createEl("div", {
      cls: `supernote-pages view-${this.viewMode} fit-${this.fitMode}`
    });
    this.pagesContainer.style.setProperty("--zoom-level", `${this.zoomLevel}%`);
    for (let i = 0; i < note.pages.length; i++) {
      if (generation !== this.renderGeneration)
        return;
      const pageContainer = this.pagesContainer.createEl("div", { cls: "supernote-page" });
      this.pageElements.push(pageContainer);
      pageContainer.createEl("div", {
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
    await this.saveFilePosition();
    this.clearView();
  }
  async onClose() {
    await this.saveFilePosition();
    this.clearView();
  }
};
var SupernoteViewerPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.data = DEFAULT_DATA;
  }
  async onload() {
    await this.loadPluginData();
    this.registerView(VIEW_TYPE_SUPERNOTE, (leaf) => new SupernoteView(leaf, this));
    this.registerExtensions(["note"], VIEW_TYPE_SUPERNOTE);
    console.log("Supernote Viewer plugin loaded");
  }
  onunload() {
    console.log("Supernote Viewer plugin unloaded");
  }
  async loadPluginData() {
    const loaded = await this.loadData();
    if (loaded) {
      this.data = {
        settings: { ...DEFAULT_SETTINGS, ...loaded.settings },
        filePositions: loaded.filePositions || {}
      };
    }
  }
  getData() {
    return this.data;
  }
  async saveData(data) {
    this.data = data;
    await super.saveData(data);
  }
};

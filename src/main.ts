import { Plugin, TFile, WorkspaceLeaf, FileView, Menu } from 'obsidian';
import { parseSupernoteFile, SupernoteFile } from './parser';
import { renderPage, imageDataToDataUrl } from './renderer';
import { AnnotatedPdfView, VIEW_TYPE_ANNOTATED_PDF } from './pdf-view';

const VIEW_TYPE_SUPERNOTE = 'supernote-viewer';

type ViewMode = 'single' | 'two-page';
type FitMode = 'width' | 'height';

interface ViewSettings {
  viewMode: ViewMode;
  fitMode: FitMode;
  zoomLevel: number;
  showThumbnails: boolean;
  adaptToTheme: boolean;
}

interface PluginData {
  settings: ViewSettings;
  filePositions: Record<string, number>; // filePath -> pageNumber
}

const DEFAULT_SETTINGS: ViewSettings = {
  viewMode: 'single',
  fitMode: 'width',
  zoomLevel: 100,
  showThumbnails: true,
  adaptToTheme: true,
};

const DEFAULT_DATA: PluginData = {
  settings: DEFAULT_SETTINGS,
  filePositions: {},
};

// In-memory cache for rendered images
interface CacheEntry {
  mtime: number;
  images: string[];
  totalPages: number;
}

const MAX_CACHE_ENTRIES = 10; // Limit memory usage

class SupernoteView extends FileView {
  private viewContent: HTMLElement;
  private currentFile: TFile | null = null;
  private renderedImages: string[] = [];
  private plugin: SupernoteViewerPlugin;
  private renderGeneration: number = 0; // For cancelling stale renders
  private fileChangeHandler: ((file: TFile) => void) | null = null;

  // View settings (loaded from plugin)
  private viewMode: ViewMode = 'single';
  private fitMode: FitMode = 'width';
  private zoomLevel: number = 100;
  private showThumbnails: boolean = true;
  private adaptToTheme: boolean = true;

  private currentPage: number = 1;
  private totalPages: number = 0;

  // DOM elements
  private pagesContainer: HTMLElement | null = null;
  private contentArea: HTMLElement | null = null;
  private pageElements: HTMLElement[] = [];
  private pageDisplay: HTMLElement | null = null;
  private pageInput: HTMLInputElement | null = null;
  private thumbnailContainer: HTMLElement | null = null;
  private thumbnailElements: HTMLElement[] = [];
  private mainContainer: HTMLElement | null = null;
  private scrollObserver: IntersectionObserver | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: SupernoteViewerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.viewContent = this.containerEl.children[1] as HTMLElement;
    this.loadSettings();
    this.setupFileWatcher();
  }

  private setupFileWatcher(): void {
    // Watch for file changes to auto-refresh
    this.fileChangeHandler = (changedFile: TFile) => {
      if (this.file && changedFile.path === this.file.path) {
        // File was modified, invalidate cache and reload
        this.plugin.invalidateCache(this.file.path);
        this.onLoadFile(this.file);
      }
    };
    this.app.vault.on('modify', this.fileChangeHandler);
  }

  private loadSettings(): void {
    const settings = this.plugin.getData().settings;
    this.viewMode = settings.viewMode;
    this.fitMode = settings.fitMode;
    this.zoomLevel = settings.zoomLevel;
    this.showThumbnails = settings.showThumbnails;
    this.adaptToTheme = settings.adaptToTheme ?? true;
  }

  private async saveSettings(): Promise<void> {
    const data = this.plugin.getData();
    data.settings = {
      viewMode: this.viewMode,
      fitMode: this.fitMode,
      zoomLevel: this.zoomLevel,
      showThumbnails: this.showThumbnails,
      adaptToTheme: this.adaptToTheme,
    };
    await this.plugin.saveData(data);
  }

  private async saveFilePosition(): Promise<void> {
    if (!this.file) return;
    const data = this.plugin.getData();
    data.filePositions[this.file.path] = this.currentPage;
    await this.plugin.saveData(data);
  }

  private loadFilePosition(): number {
    if (!this.file) return 1;
    const data = this.plugin.getData();
    return data.filePositions[this.file.path] || 1;
  }

  getViewType(): string {
    return VIEW_TYPE_SUPERNOTE;
  }

  getDisplayText(): string {
    return this.file?.basename || 'Supernote Viewer';
  }

  async onLoadFile(file: TFile): Promise<void> {
    // Cancel any previous render
    this.renderGeneration++;
    const currentGeneration = this.renderGeneration;

    this.clearView();
    this.currentFile = file;

    // Load saved page position for this file
    const savedPage = this.loadFilePosition();

    // Check cache first
    const cachedEntry = this.plugin.getCachedImages(file.path, file.stat.mtime);

    if (cachedEntry) {
      // Use cached images - instant load!
      this.renderedImages = cachedEntry.images;
      this.totalPages = cachedEntry.totalPages;
      this.currentPage = Math.min(savedPage, this.totalPages);

      this.renderToolbar();
      this.mainContainer = this.viewContent.createEl('div', { cls: 'supernote-main' });
      this.applyThemeAdaptation();
      this.renderThumbnailSidebar();
      this.renderPagesFromCache(currentGeneration);

      if (currentGeneration !== this.renderGeneration) return;

      this.setupScrollObserver();

      if (this.currentPage > 1) {
        const pageEl = this.pageElements[this.currentPage - 1];
        if (pageEl) {
          pageEl.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      }

      this.updateThumbnailHighlight();
      this.populateThumbnailsAsync(currentGeneration);
      return;
    }

    // No cache - render from scratch
    const loadingEl = this.viewContent.createEl('div', {
      cls: 'supernote-loading',
      text: 'Loading...',
    });

    try {
      const buffer = await this.app.vault.readBinary(file);

      // Check if we're still the current render
      if (currentGeneration !== this.renderGeneration) return;

      const data = new Uint8Array(buffer);
      const note = parseSupernoteFile(data);

      // Check again after parsing
      if (currentGeneration !== this.renderGeneration) return;

      this.totalPages = note.pages.length;
      this.currentPage = Math.min(savedPage, this.totalPages);

      loadingEl.remove();

      // Render toolbar
      this.renderToolbar();

      // Create main layout with sidebar and content
      this.mainContainer = this.viewContent.createEl('div', { cls: 'supernote-main' });
      this.applyThemeAdaptation();

      // Render thumbnail sidebar (empty initially)
      this.renderThumbnailSidebar();

      // Render pages
      await this.renderPages(note, currentGeneration);

      // Check if still current render
      if (currentGeneration !== this.renderGeneration) return;

      // Cache the rendered images
      this.plugin.setCachedImages(file.path, file.stat.mtime, this.renderedImages, this.totalPages);

      // Setup scroll observer
      this.setupScrollObserver();

      // Scroll to saved page position
      if (this.currentPage > 1) {
        // Use instant scroll for initial position
        const pageEl = this.pageElements[this.currentPage - 1];
        if (pageEl) {
          pageEl.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
      }

      // Update initial thumbnail highlight
      this.updateThumbnailHighlight();

      // Populate thumbnails in the background (don't await)
      this.populateThumbnailsAsync(currentGeneration);

    } catch (error) {
      if (currentGeneration !== this.renderGeneration) return;
      loadingEl.remove();
      this.viewContent.createEl('div', {
        cls: 'supernote-error',
        text: `Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      console.error('Supernote Viewer error:', error);
    }
  }

  private renderPagesFromCache(generation: number): void {
    if (!this.mainContainer) return;

    this.contentArea = this.mainContainer.createEl('div', { cls: 'supernote-content' });

    this.pagesContainer = this.contentArea.createEl('div', {
      cls: `supernote-pages view-${this.viewMode} fit-${this.fitMode}`
    });
    this.pagesContainer.style.setProperty('--zoom-level', `${this.zoomLevel}%`);

    for (let i = 0; i < this.renderedImages.length; i++) {
      if (generation !== this.renderGeneration) return;

      const pageContainer = this.pagesContainer.createEl('div', { cls: 'supernote-page' });
      this.pageElements.push(pageContainer);

      const img = pageContainer.createEl('img', {
        cls: 'supernote-page-image',
      });
      img.src = this.renderedImages[i];
      img.alt = `Page ${i + 1}`;
    }
  }

  private clearView(): void {
    // Disconnect observer
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
      this.scrollObserver = null;
    }

    this.viewContent.empty();
    this.renderedImages = [];
    this.currentFile = null;
    this.pagesContainer = null;
    this.contentArea = null;
    this.pageElements = [];
    this.pageDisplay = null;
    this.pageInput = null;
    this.thumbnailContainer = null;
    this.thumbnailElements = [];
    this.mainContainer = null;
  }

  private renderToolbar(): void {
    const toolbar = this.viewContent.createEl('div', { cls: 'supernote-toolbar' });

    // Left section: Thumbnail toggle
    const leftSection = toolbar.createEl('div', { cls: 'supernote-toolbar-section' });

    const thumbnailBtn = leftSection.createEl('button', {
      cls: 'supernote-toolbar-btn clickable-icon',
      attr: { 'aria-label': 'Toggle thumbnails' },
    });
    thumbnailBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect></svg>';
    thumbnailBtn.addEventListener('click', () => this.toggleThumbnails());

    // Center section: Page navigation
    const navSection = toolbar.createEl('div', { cls: 'supernote-toolbar-section' });

    const prevBtn = navSection.createEl('button', {
      cls: 'supernote-toolbar-btn clickable-icon',
      attr: { 'aria-label': 'Previous page' },
    });
    prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
    prevBtn.addEventListener('click', () => this.goToPrevPage());

    const nextBtn = navSection.createEl('button', {
      cls: 'supernote-toolbar-btn clickable-icon',
      attr: { 'aria-label': 'Next page' },
    });
    nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    nextBtn.addEventListener('click', () => this.goToNextPage());

    // Page display container with input
    this.pageDisplay = navSection.createEl('div', { cls: 'supernote-page-display' });

    this.pageInput = this.pageDisplay.createEl('input', {
      cls: 'supernote-page-input',
      attr: {
        type: 'text',
        value: String(this.currentPage),
        'aria-label': 'Go to page'
      },
    });
    this.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handlePageInput();
        this.pageInput?.blur();
      }
    });
    this.pageInput.addEventListener('blur', () => this.handlePageInput());
    this.pageInput.addEventListener('focus', () => this.pageInput?.select());

    this.pageDisplay.createEl('span', {
      cls: 'supernote-page-total',
      text: ` of ${this.totalPages}`,
    });

    // Zoom section
    const zoomSection = toolbar.createEl('div', { cls: 'supernote-toolbar-section' });

    const zoomOutBtn = zoomSection.createEl('button', {
      cls: 'supernote-toolbar-btn clickable-icon',
      attr: { 'aria-label': 'Zoom out' },
    });
    zoomOutBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>';
    zoomOutBtn.addEventListener('click', () => this.zoomOut());

    const zoomInBtn = zoomSection.createEl('button', {
      cls: 'supernote-toolbar-btn clickable-icon',
      attr: { 'aria-label': 'Zoom in' },
    });
    zoomInBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>';
    zoomInBtn.addEventListener('click', () => this.zoomIn());

    // Options dropdown
    const optionsSection = toolbar.createEl('div', { cls: 'supernote-toolbar-section' });

    const optionsBtn = optionsSection.createEl('button', {
      cls: 'supernote-toolbar-btn clickable-icon',
      attr: { 'aria-label': 'View options' },
    });
    optionsBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    optionsBtn.addEventListener('click', (e) => this.showOptionsMenu(e));
  }

  private renderThumbnailSidebar(): void {
    if (!this.mainContainer) return;

    // Sidebar container
    const sidebar = this.mainContainer.createEl('div', {
      cls: `supernote-sidebar ${this.showThumbnails ? '' : 'hidden'}`,
    });

    // Resize handle
    const resizeHandle = sidebar.createEl('div', { cls: 'supernote-sidebar-resize' });
    this.setupResizeHandle(resizeHandle, sidebar);

    // Thumbnail list
    this.thumbnailContainer = sidebar.createEl('div', { cls: 'supernote-thumbnails' });
  }

  private setupResizeHandle(handle: HTMLElement, sidebar: HTMLElement): void {
    let startX: number;
    let startWidth: number;

    const onMouseMove = (e: MouseEvent) => {
      const newWidth = startWidth + (e.clientX - startX);
      if (newWidth >= 100 && newWidth <= 400) {
        sidebar.style.width = `${newWidth}px`;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.removeClass('supernote-resizing');
    };

    handle.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.addClass('supernote-resizing');
    });
  }

  private toggleThumbnails(): void {
    this.showThumbnails = !this.showThumbnails;
    const sidebar = this.mainContainer?.querySelector('.supernote-sidebar');
    if (sidebar) {
      sidebar.toggleClass('hidden', !this.showThumbnails);
    }
    this.saveSettings();
  }

  private async populateThumbnailsAsync(generation: number): Promise<void> {
    if (!this.thumbnailContainer || this.renderedImages.length === 0) return;

    this.thumbnailElements = [];

    // Create placeholder wrappers immediately for all pages
    for (let index = 0; index < this.renderedImages.length; index++) {
      if (generation !== this.renderGeneration) return;

      const thumbWrapper = this.thumbnailContainer.createEl('div', {
        cls: 'supernote-thumbnail-wrapper',
        attr: { 'data-page': String(index + 1) },
      });

      thumbWrapper.createEl('div', {
        cls: 'supernote-thumbnail-number',
        text: String(index + 1),
      });

      thumbWrapper.addEventListener('click', () => {
        this.currentPage = index + 1;
        this.scrollToPage(this.currentPage);
        this.updatePageDisplay();
        this.updateThumbnailHighlight();
        this.saveFilePosition();
      });

      this.thumbnailElements.push(thumbWrapper);
    }

    // Update highlight for current page
    this.updateThumbnailHighlight();

    // Now load images progressively
    for (let index = 0; index < this.renderedImages.length; index++) {
      if (generation !== this.renderGeneration) return;

      const dataUrl = this.renderedImages[index];
      const thumbWrapper = this.thumbnailElements[index];

      if (thumbWrapper && dataUrl) {
        const thumb = document.createElement('img');
        thumb.className = 'supernote-thumbnail';
        thumb.src = dataUrl;
        thumb.alt = `Page ${index + 1}`;
        thumbWrapper.insertBefore(thumb, thumbWrapper.firstChild);
      }

      // Yield to allow UI updates
      if (index % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  private updateThumbnailHighlight(): void {
    this.thumbnailElements.forEach((el, index) => {
      el.toggleClass('active', index === this.currentPage - 1);
    });

    // Scroll thumbnail into view
    const activeThumbnail = this.thumbnailElements[this.currentPage - 1];
    if (activeThumbnail && this.thumbnailContainer) {
      activeThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  private showOptionsMenu(e: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle('Fit width');
      item.setChecked(this.fitMode === 'width');
      item.onClick(() => {
        this.fitMode = 'width';
        this.applyViewSettings();
        this.saveSettings();
      });
    });

    menu.addItem((item) => {
      item.setTitle('Fit height');
      item.setChecked(this.fitMode === 'height');
      item.onClick(() => {
        this.fitMode = 'height';
        this.applyViewSettings();
        this.saveSettings();
      });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle('Single page');
      item.setChecked(this.viewMode === 'single');
      item.onClick(() => {
        this.viewMode = 'single';
        this.applyViewSettings();
        this.saveSettings();
      });
    });

    menu.addItem((item) => {
      item.setTitle('Two-page');
      item.setChecked(this.viewMode === 'two-page');
      item.onClick(() => {
        this.viewMode = 'two-page';
        this.applyViewSettings();
        this.saveSettings();
      });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle('Adapt to theme');
      item.setChecked(this.adaptToTheme);
      item.onClick(() => {
        this.adaptToTheme = !this.adaptToTheme;
        this.applyThemeAdaptation();
        this.saveSettings();
      });
    });

    menu.showAtMouseEvent(e);
  }

  private applyThemeAdaptation(): void {
    // Apply or remove the theme adaptation class
    if (this.mainContainer) {
      this.mainContainer.toggleClass('no-theme-adapt', !this.adaptToTheme);
    }
  }

  private goToPrevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.scrollToPage(this.currentPage);
      this.updatePageDisplay();
      this.updateThumbnailHighlight();
      this.saveFilePosition();
    }
  }

  private goToNextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.scrollToPage(this.currentPage);
      this.updatePageDisplay();
      this.updateThumbnailHighlight();
      this.saveFilePosition();
    }
  }

  private scrollToPage(pageNum: number): void {
    const pageEl = this.pageElements[pageNum - 1];
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private updatePageDisplay(): void {
    if (this.pageInput) {
      this.pageInput.value = String(this.currentPage);
    }
  }

  private handlePageInput(): void {
    if (!this.pageInput) return;

    const value = parseInt(this.pageInput.value, 10);
    if (!isNaN(value) && value >= 1 && value <= this.totalPages) {
      this.currentPage = value;
      this.scrollToPage(this.currentPage);
      this.updateThumbnailHighlight();
      this.saveFilePosition();
    } else {
      // Reset to current page if invalid
      this.pageInput.value = String(this.currentPage);
    }
  }

  private zoomIn(): void {
    if (this.zoomLevel < 200) {
      this.zoomLevel += 25;
      this.applyZoom();
      this.saveSettings();
    }
  }

  private zoomOut(): void {
    if (this.zoomLevel > 50) {
      this.zoomLevel -= 25;
      this.applyZoom();
      this.saveSettings();
    }
  }

  private applyZoom(): void {
    if (this.pagesContainer) {
      this.pagesContainer.style.setProperty('--zoom-level', `${this.zoomLevel}%`);
    }
  }

  private applyViewSettings(): void {
    if (!this.pagesContainer) return;

    this.pagesContainer.removeClass('view-single', 'view-two-page');
    this.pagesContainer.addClass(`view-${this.viewMode}`);

    this.pagesContainer.removeClass('fit-width', 'fit-height');
    this.pagesContainer.addClass(`fit-${this.fitMode}`);
  }

  private setupScrollObserver(): void {
    if (!this.contentArea) return;

    // Disconnect previous observer if exists
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }

    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        // Find the most visible page
        let mostVisibleEntry: IntersectionObserverEntry | null = null;
        let maxRatio = 0;

        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            mostVisibleEntry = entry;
          }
        }

        if (mostVisibleEntry) {
          const pageIndex = this.pageElements.indexOf(mostVisibleEntry.target as HTMLElement);
          if (pageIndex !== -1 && this.currentPage !== pageIndex + 1) {
            this.currentPage = pageIndex + 1;
            this.updatePageDisplay();
            this.updateThumbnailHighlight();
            // Debounce saving position to avoid too many writes
            this.debouncedSavePosition();
          }
        }
      },
      {
        root: this.contentArea,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    this.pageElements.forEach((el) => this.scrollObserver?.observe(el));
  }

  private savePositionTimeout: number | null = null;
  private debouncedSavePosition(): void {
    if (this.savePositionTimeout) {
      window.clearTimeout(this.savePositionTimeout);
    }
    this.savePositionTimeout = window.setTimeout(() => {
      this.saveFilePosition();
    }, 500);
  }

  private async renderPages(note: SupernoteFile, generation: number): Promise<void> {
    if (!this.mainContainer) return;

    // Content area
    this.contentArea = this.mainContainer.createEl('div', { cls: 'supernote-content' });

    this.pagesContainer = this.contentArea.createEl('div', {
      cls: `supernote-pages view-${this.viewMode} fit-${this.fitMode}`
    });
    this.pagesContainer.style.setProperty('--zoom-level', `${this.zoomLevel}%`);

    for (let i = 0; i < note.pages.length; i++) {
      // Check if this render is still current
      if (generation !== this.renderGeneration) return;

      const pageContainer = this.pagesContainer.createEl('div', { cls: 'supernote-page' });
      this.pageElements.push(pageContainer);

      try {
        const imageData = renderPage(note, i);
        if (imageData) {
          const dataUrl = imageDataToDataUrl(imageData);
          this.renderedImages.push(dataUrl);

          const img = pageContainer.createEl('img', {
            cls: 'supernote-page-image',
          });
          img.src = dataUrl;
          img.alt = `Page ${i + 1}`;
        }
      } catch (error) {
        pageContainer.createEl('div', {
          cls: 'supernote-page-error',
          text: `Error rendering page ${i + 1}`,
        });
        console.error(`Error rendering page ${i + 1}:`, error);
      }

      // Yield to allow UI updates and check cancellation
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  async onUnloadFile(file: TFile): Promise<void> {
    // Save position before unloading
    await this.saveFilePosition();
    this.clearView();
  }

  async onClose(): Promise<void> {
    await this.saveFilePosition();
    // Clean up file watcher
    if (this.fileChangeHandler) {
      this.app.vault.off('modify', this.fileChangeHandler);
      this.fileChangeHandler = null;
    }
    this.clearView();
  }
}

export default class SupernoteViewerPlugin extends Plugin {
  private data: PluginData = DEFAULT_DATA;
  private imageCache: Map<string, CacheEntry> = new Map();
  private cacheOrder: string[] = []; // Track insertion order for LRU eviction

  async onload(): Promise<void> {
    await this.loadPluginData();

    // Register .note file viewer
    this.registerView(VIEW_TYPE_SUPERNOTE, (leaf) => new SupernoteView(leaf, this));
    this.registerExtensions(['note'], VIEW_TYPE_SUPERNOTE);

    // Register annotated PDF viewer (but don't register for PDF extension - we use file menu)
    this.registerView(VIEW_TYPE_ANNOTATED_PDF, (leaf) => new AnnotatedPdfView(leaf));

    // Auto-detect PDFs with annotations and open in our viewer
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file || file.extension !== 'pdf') return;

        // Check if .mark file exists
        const markPath = file.path + '.mark';
        const markFile = this.app.vault.getAbstractFileByPath(markPath);

        if (markFile) {
          // Get the current leaf
          const leaf = this.app.workspace.getLeaf(false);
          if (!leaf) return;

          // Check if already in our viewer to avoid loops
          if (leaf.view.getViewType() === VIEW_TYPE_ANNOTATED_PDF) return;

          // Switch to our annotated PDF viewer
          leaf.setViewState({
            type: VIEW_TYPE_ANNOTATED_PDF,
            state: { file: file.path },
          });
        }
      })
    );

    // Also add file menu option for manual access
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'pdf') {
          // Check if .mark file exists
          const markPath = file.path + '.mark';
          const markFile = this.app.vault.getAbstractFileByPath(markPath);

          if (markFile) {
            menu.addItem((item) => {
              item.setTitle('Open with annotations')
                .setIcon('pencil')
                .onClick(async () => {
                  const leaf = this.app.workspace.getLeaf();
                  await leaf.setViewState({
                    type: VIEW_TYPE_ANNOTATED_PDF,
                    state: { file: file.path },
                  });
                });
            });
          }
        }
      })
    );

    console.log('Supernote Viewer plugin loaded');
  }

  onunload(): void {
    this.imageCache.clear();
    this.cacheOrder = [];
    console.log('Supernote Viewer plugin unloaded');
  }

  private async loadPluginData(): Promise<void> {
    const loaded = await this.loadData();
    if (loaded) {
      this.data = {
        settings: { ...DEFAULT_SETTINGS, ...loaded.settings },
        filePositions: loaded.filePositions || {},
      };
    }
  }

  getData(): PluginData {
    return this.data;
  }

  async saveData(data: PluginData): Promise<void> {
    this.data = data;
    await super.saveData(data);
  }

  // Cache methods
  getCachedImages(filePath: string, mtime: number): CacheEntry | null {
    const entry = this.imageCache.get(filePath);
    if (entry && entry.mtime === mtime) {
      // Move to end of order (most recently used)
      this.cacheOrder = this.cacheOrder.filter(p => p !== filePath);
      this.cacheOrder.push(filePath);
      return entry;
    }
    return null;
  }

  setCachedImages(filePath: string, mtime: number, images: string[], totalPages: number): void {
    // Evict oldest entries if cache is full
    while (this.cacheOrder.length >= MAX_CACHE_ENTRIES) {
      const oldest = this.cacheOrder.shift();
      if (oldest) {
        this.imageCache.delete(oldest);
      }
    }

    this.imageCache.set(filePath, { mtime, images, totalPages });
    this.cacheOrder = this.cacheOrder.filter(p => p !== filePath);
    this.cacheOrder.push(filePath);
  }

  invalidateCache(filePath: string): void {
    this.imageCache.delete(filePath);
    this.cacheOrder = this.cacheOrder.filter(p => p !== filePath);
  }
}

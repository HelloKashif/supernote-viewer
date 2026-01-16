import { Plugin, TFile, WorkspaceLeaf, FileView } from 'obsidian';
import { parseSupernoteFile, SupernoteFile } from './parser';
import { renderPage, imageDataToDataUrl } from './renderer';

const VIEW_TYPE_SUPERNOTE = 'supernote-viewer';

type ViewMode = 'single' | 'two-page';
type FitMode = 'width' | 'height';

class SupernoteView extends FileView {
  private viewContent: HTMLElement;
  private currentFile: TFile | null = null;
  private renderedImages: string[] = [];

  // View settings
  private viewMode: ViewMode = 'single';
  private fitMode: FitMode = 'width';
  private pagesContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.viewContent = this.containerEl.children[1] as HTMLElement;
  }

  getViewType(): string {
    return VIEW_TYPE_SUPERNOTE;
  }

  getDisplayText(): string {
    return this.file?.basename || 'Supernote Viewer';
  }

  async onLoadFile(file: TFile): Promise<void> {
    // Clear everything first to prevent ghosting
    this.clearView();
    this.currentFile = file;

    // Show loading state
    const loadingEl = this.viewContent.createEl('div', {
      cls: 'supernote-loading',
      text: 'Loading...',
    });

    try {
      // Read file as binary
      const buffer = await this.app.vault.readBinary(file);
      const data = new Uint8Array(buffer);

      // Parse the file
      const note = parseSupernoteFile(data);

      // Remove loading state
      loadingEl.remove();

      // Render toolbar
      this.renderToolbar(note);

      // Render pages
      await this.renderPages(note);
    } catch (error) {
      loadingEl.remove();
      this.viewContent.createEl('div', {
        cls: 'supernote-error',
        text: `Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      console.error('Supernote Viewer error:', error);
    }
  }

  private clearView(): void {
    this.viewContent.empty();
    this.renderedImages = [];
    this.currentFile = null;
    this.pagesContainer = null;
  }

  private renderToolbar(note: SupernoteFile): void {
    // Floating buttons container in top right
    const controls = this.viewContent.createEl('div', { cls: 'supernote-floating-controls' });

    // View mode toggle (single / two-page)
    const viewModeBtn = controls.createEl('button', {
      cls: 'supernote-icon-btn',
      attr: { 'aria-label': 'Toggle single/two-page view', 'title': 'Toggle view mode' },
    });
    this.updateViewModeButton(viewModeBtn);
    viewModeBtn.addEventListener('click', () => {
      this.viewMode = this.viewMode === 'single' ? 'two-page' : 'single';
      this.updateViewModeButton(viewModeBtn);
      this.applyViewSettings();
    });

    // Fit mode toggle (width / height)
    const fitModeBtn = controls.createEl('button', {
      cls: 'supernote-icon-btn',
      attr: { 'aria-label': 'Toggle fit width/height', 'title': 'Toggle fit mode' },
    });
    this.updateFitModeButton(fitModeBtn);
    fitModeBtn.addEventListener('click', () => {
      this.fitMode = this.fitMode === 'width' ? 'height' : 'width';
      this.updateFitModeButton(fitModeBtn);
      this.applyViewSettings();
    });
  }

  private updateViewModeButton(btn: HTMLElement): void {
    // Use simple icons: ▢ for single, ▢▢ for two-page
    if (this.viewMode === 'single') {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
      btn.removeClass('active');
      btn.setAttribute('title', 'Single page view');
    } else {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="8" height="18" rx="1"/><rect x="14" y="3" width="8" height="18" rx="1"/></svg>';
      btn.addClass('active');
      btn.setAttribute('title', 'Two-page view');
    }
  }

  private updateFitModeButton(btn: HTMLElement): void {
    // Use arrows: ↔ for width, ↕ for height
    if (this.fitMode === 'width') {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12H3M21 12l-4-4M21 12l-4 4M3 12l4-4M3 12l4 4"/></svg>';
      btn.removeClass('active');
      btn.setAttribute('title', 'Fit to width');
    } else {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M12 3l-4 4M12 3l4 4M12 21l-4-4M12 21l4-4"/></svg>';
      btn.addClass('active');
      btn.setAttribute('title', 'Fit to height');
    }
  }

  private applyViewSettings(): void {
    if (!this.pagesContainer) return;

    // Update view mode class
    this.pagesContainer.removeClass('view-single', 'view-two-page');
    this.pagesContainer.addClass(`view-${this.viewMode === 'single' ? 'single' : 'two-page'}`);

    // Update fit mode class
    this.pagesContainer.removeClass('fit-width', 'fit-height');
    this.pagesContainer.addClass(`fit-${this.fitMode}`);
  }

  private async renderPages(note: SupernoteFile): Promise<void> {
    this.pagesContainer = this.viewContent.createEl('div', {
      cls: `supernote-pages view-${this.viewMode === 'single' ? 'single' : 'two-page'} fit-${this.fitMode}`
    });

    for (let i = 0; i < note.pages.length; i++) {
      // Check if we're still viewing the same file
      if (this.currentFile !== this.file) {
        return; // File changed, stop rendering
      }

      const pageContainer = this.pagesContainer.createEl('div', { cls: 'supernote-page' });

      // Page number overlay
      const pageNumber = pageContainer.createEl('div', {
        cls: 'supernote-page-number',
        text: `${i + 1}`,
      });

      // Render page image
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

      // Yield to allow UI updates between pages
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.clearView();
  }

  async onClose(): Promise<void> {
    this.clearView();
  }
}

export default class SupernoteViewerPlugin extends Plugin {
  async onload(): Promise<void> {
    // Register the custom view
    this.registerView(VIEW_TYPE_SUPERNOTE, (leaf) => new SupernoteView(leaf));

    // Register .note file extension
    this.registerExtensions(['note'], VIEW_TYPE_SUPERNOTE);

    console.log('Supernote Viewer plugin loaded');
  }

  onunload(): void {
    console.log('Supernote Viewer plugin unloaded');
  }
}

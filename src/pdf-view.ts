/**
 * PDF Viewer with Supernote annotation overlay
 * Only activates for PDFs that have associated .mark files
 */

import { TFile, WorkspaceLeaf, FileView, Menu } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import { parseMarkFile, MarkFile, getAnnotationDimensions } from './mark-parser';
import { renderAnnotationLayer, annotationToDataUrl, getAnnotatedPageNumbers } from './mark-renderer';

// Set worker path for pdf.js - use unpkg for exact version match
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs';

export const VIEW_TYPE_ANNOTATED_PDF = 'supernote-pdf-viewer';

interface AnnotationCache {
  [pageNum: number]: string; // pageNum -> dataUrl
}

export class AnnotatedPdfView extends FileView {
  private viewContent: HTMLElement;
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private markFile: MarkFile | null = null;
  private annotationCache: AnnotationCache = {};
  private showAnnotations: boolean = true;
  private currentPage: number = 1;
  private totalPages: number = 0;
  private scale: number = 1.5;
  private renderGeneration: number = 0;

  // DOM elements
  private toolbar: HTMLElement | null = null;
  private pagesContainer: HTMLElement | null = null;
  private pageElements: HTMLElement[] = [];
  private annotationToggle: HTMLElement | null = null;
  private annotationNavDisplay: HTMLElement | null = null;

  // Annotation navigation
  private annotatedPages: number[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.viewContent = this.containerEl.children[1] as HTMLElement;
  }

  getViewType(): string {
    return VIEW_TYPE_ANNOTATED_PDF;
  }

  getDisplayText(): string {
    if (this.file) {
      return `${this.file.basename} (Annotated)`;
    }
    return 'Annotated PDF';
  }

  getIcon(): string {
    return 'file-text';
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.renderGeneration++;
    const currentGeneration = this.renderGeneration;

    this.clearView();

    // Show loading
    const loadingEl = this.viewContent.createEl('div', {
      cls: 'supernote-loading',
      text: 'Loading PDF...',
    });

    try {
      // Load PDF
      const pdfBuffer = await this.app.vault.readBinary(file);
      const pdfData = new Uint8Array(pdfBuffer);

      if (currentGeneration !== this.renderGeneration) return;

      this.pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      this.totalPages = this.pdfDoc.numPages;

      // Try to load associated .mark file
      const markPath = file.path + '.mark';
      const markFile = this.app.vault.getAbstractFileByPath(markPath);

      if (markFile && markFile instanceof TFile) {
        const markBuffer = await this.app.vault.readBinary(markFile);
        const markData = new Uint8Array(markBuffer);
        this.markFile = parseMarkFile(markData);

        // Pre-render annotation layers
        const annotatedPageNums = getAnnotatedPageNumbers(this.markFile);
        for (const pageNum of annotatedPageNums) {
          const imageData = renderAnnotationLayer(this.markFile, pageNum);
          if (imageData) {
            this.annotationCache[pageNum] = annotationToDataUrl(imageData);
            this.annotatedPages.push(pageNum);
          }
        }
        // Sort annotated pages
        this.annotatedPages.sort((a, b) => a - b);
      }

      if (currentGeneration !== this.renderGeneration) return;

      loadingEl.remove();

      // Render UI
      this.renderToolbar();
      this.pagesContainer = this.viewContent.createEl('div', { cls: 'annotated-pdf-pages' });

      // Render all pages
      await this.renderAllPages(currentGeneration);

    } catch (error) {
      if (currentGeneration !== this.renderGeneration) return;
      loadingEl.remove();
      this.viewContent.createEl('div', {
        cls: 'supernote-error',
        text: `Error loading PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      console.error('PDF Viewer error:', error);
    }
  }

  private clearView(): void {
    this.viewContent.empty();
    this.pdfDoc = null;
    this.markFile = null;
    this.annotationCache = {};
    this.toolbar = null;
    this.pagesContainer = null;
    this.pageElements = [];
    this.annotationToggle = null;
    this.annotationNavDisplay = null;
    this.annotatedPages = [];
  }

  private renderToolbar(): void {
    this.toolbar = this.viewContent.createEl('div', { cls: 'supernote-toolbar' });

    // Annotation controls (only show if we have annotations)
    if (this.markFile && this.annotatedPages.length > 0) {
      const annotationSection = this.toolbar.createEl('div', { cls: 'supernote-toolbar-section' });

      // Toggle button
      this.annotationToggle = annotationSection.createEl('button', {
        cls: 'supernote-toolbar-btn clickable-icon',
        attr: { 'aria-label': 'Toggle annotations' },
      });
      this.updateAnnotationToggleIcon();
      this.annotationToggle.addEventListener('click', () => this.toggleAnnotations());

      // Previous annotation button
      const prevBtn = annotationSection.createEl('button', {
        cls: 'supernote-toolbar-btn clickable-icon',
        attr: { 'aria-label': 'Previous annotation' },
      });
      prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
      prevBtn.addEventListener('click', () => this.goToPrevAnnotation());

      // Next annotation button
      const nextBtn = annotationSection.createEl('button', {
        cls: 'supernote-toolbar-btn clickable-icon',
        attr: { 'aria-label': 'Next annotation' },
      });
      nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
      nextBtn.addEventListener('click', () => this.goToNextAnnotation());

      // Annotation count display
      this.annotationNavDisplay = annotationSection.createEl('span', {
        cls: 'supernote-toolbar-label',
        text: `${this.annotatedPages.length} annotated`,
      });
    }

    // Page info
    const pageSection = this.toolbar.createEl('div', { cls: 'supernote-toolbar-section' });
    pageSection.createEl('span', {
      cls: 'supernote-page-display',
      text: `${this.totalPages} pages`,
    });

    // Zoom controls
    const zoomSection = this.toolbar.createEl('div', { cls: 'supernote-toolbar-section' });

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
  }

  private updateAnnotationToggleIcon(): void {
    if (!this.annotationToggle) return;

    if (this.showAnnotations) {
      // Eye icon (annotations visible)
      this.annotationToggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    } else {
      // Eye-off icon (annotations hidden)
      this.annotationToggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
    }
  }

  private toggleAnnotations(): void {
    this.showAnnotations = !this.showAnnotations;
    this.updateAnnotationToggleIcon();

    // Toggle visibility of all annotation overlays
    const overlays = this.viewContent.querySelectorAll('.annotation-overlay');
    overlays.forEach(overlay => {
      (overlay as HTMLElement).style.display = this.showAnnotations ? 'block' : 'none';
    });
  }

  private goToNextAnnotation(): void {
    if (this.annotatedPages.length === 0) return;

    // Find the next annotated page after current position
    const nextPage = this.annotatedPages.find(p => p > this.currentPage);
    if (nextPage) {
      this.scrollToPage(nextPage);
    } else {
      // Wrap around to first annotated page
      this.scrollToPage(this.annotatedPages[0]);
    }
  }

  private goToPrevAnnotation(): void {
    if (this.annotatedPages.length === 0) return;

    // Find the previous annotated page before current position
    const prevPages = this.annotatedPages.filter(p => p < this.currentPage);
    if (prevPages.length > 0) {
      this.scrollToPage(prevPages[prevPages.length - 1]);
    } else {
      // Wrap around to last annotated page
      this.scrollToPage(this.annotatedPages[this.annotatedPages.length - 1]);
    }
  }

  private scrollToPage(pageNum: number): void {
    this.currentPage = pageNum;
    const pageEl = this.pageElements[pageNum - 1];
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private async zoomIn(): Promise<void> {
    if (this.scale < 3) {
      this.scale += 0.25;
      await this.reRenderPages();
    }
  }

  private async zoomOut(): Promise<void> {
    if (this.scale > 0.5) {
      this.scale -= 0.25;
      await this.reRenderPages();
    }
  }

  private async reRenderPages(): Promise<void> {
    this.renderGeneration++;
    const currentGeneration = this.renderGeneration;

    if (!this.pagesContainer) return;
    this.pagesContainer.empty();
    this.pageElements = [];

    await this.renderAllPages(currentGeneration);
  }

  private async renderAllPages(generation: number): Promise<void> {
    if (!this.pdfDoc || !this.pagesContainer) return;

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      if (generation !== this.renderGeneration) return;

      const pageContainer = this.pagesContainer.createEl('div', {
        cls: 'annotated-pdf-page',
        attr: { 'data-page': String(pageNum) },
      });
      this.pageElements.push(pageContainer);

      try {
        // Get PDF page
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: this.scale });

        // Create canvas for PDF
        const pdfCanvas = pageContainer.createEl('canvas', { cls: 'pdf-canvas' });
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;

        const ctx = pdfCanvas.getContext('2d')!;
        await page.render({
          canvasContext: ctx,
          viewport: viewport,
          canvas: pdfCanvas,
        } as any).promise;

        // Add annotation overlay if exists
        if (this.annotationCache[pageNum]) {
          const overlayContainer = pageContainer.createEl('div', { cls: 'annotation-overlay-container' });
          overlayContainer.style.width = `${viewport.width}px`;
          overlayContainer.style.height = `${viewport.height}px`;

          // Use canvas instead of img to avoid scaling artifacts
          const overlayCanvas = document.createElement('canvas');
          overlayCanvas.className = 'annotation-overlay';
          overlayCanvas.width = viewport.width;
          overlayCanvas.height = viewport.height;
          overlayCanvas.style.display = this.showAnnotations ? 'block' : 'none';
          overlayContainer.appendChild(overlayCanvas);

          // Load the cached image and draw it scaled to viewport
          const img = new Image();
          const cachedSrc = this.annotationCache[pageNum];
          img.onload = () => {
            const octx = overlayCanvas.getContext('2d');
            if (octx) {
              // Disable image smoothing for crisp scaling (reduces moiré)
              octx.imageSmoothingEnabled = false;

              // Calculate scaling to fit while preserving aspect ratio
              const imgAspect = img.width / img.height;
              const viewAspect = viewport.width / viewport.height;

              let drawWidth, drawHeight, drawX, drawY;

              if (Math.abs(imgAspect - viewAspect) < 0.01) {
                // Aspect ratios match closely - fill entire viewport
                drawWidth = viewport.width;
                drawHeight = viewport.height;
                drawX = 0;
                drawY = 0;
              } else if (imgAspect < viewAspect) {
                // Annotation is taller - fit to height, center horizontally
                drawHeight = viewport.height;
                drawWidth = viewport.height * imgAspect;
                drawX = (viewport.width - drawWidth) / 2;
                drawY = 0;
              } else {
                // Annotation is wider - fit to width, center vertically
                drawWidth = viewport.width;
                drawHeight = viewport.width / imgAspect;
                drawX = 0;
                drawY = (viewport.height - drawHeight) / 2;
              }

              console.log(`[pdf-view] Drawing annotation for page ${pageNum}: img=${img.width}x${img.height}, viewport=${viewport.width}x${viewport.height}, draw=${drawWidth}x${drawHeight} at (${drawX},${drawY})`);
              octx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
            }
          };
          img.onerror = (e) => {
            console.error(`[pdf-view] Failed to load annotation image for page ${pageNum}`, e);
          };
          img.src = cachedSrc;
        }

        // Page number indicator
        pageContainer.createEl('div', {
          cls: 'pdf-page-number',
          text: String(pageNum),
        });

      } catch (error) {
        pageContainer.createEl('div', {
          cls: 'supernote-page-error',
          text: `Error rendering page ${pageNum}`,
        });
        console.error(`Error rendering page ${pageNum}:`, error);
      }

      // Yield for UI updates
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

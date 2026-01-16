# Supernote Viewer for Obsidian

A lightweight Obsidian plugin that renders Supernote `.note` files directly in your vault.

## Features

- **Native rendering** of Supernote `.note` files (handwritten notes, sketches)
- **PDF-style toolbar** with page navigation, zoom controls, and view options
- **Thumbnail sidebar** with resizable panel for quick page navigation
- **View modes**: Single page or two-page layout
- **Fit modes**: Fit to width or fit to height
- **Page position memory**: Remembers your position in each file
- **Settings persistence**: Your view preferences are saved across sessions
- **Image caching**: Fast switching between previously viewed notes
- **Auto-refresh**: Automatically updates when files are synced from Supernote
- **Dark mode support**: Inverts colors for comfortable viewing in dark themes

## Installation

### Manual Installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`)
2. Create a folder called `supernote-viewer` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into this folder
4. Enable the plugin in Obsidian Settings → Community Plugins

### From Source

```bash
git clone https://github.com/HelloKashif/supernote-viewer.git
cd supernote-viewer
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugins folder.

## Usage

1. Sync your Supernote files to your Obsidian vault (e.g., using Supernote Private Cloud)
2. Click on any `.note` file in your vault
3. The file will open in the Supernote Viewer

### Controls

- **Thumbnail toggle**: Show/hide the page thumbnail sidebar
- **Page navigation**: Use up/down arrows or click on thumbnails
- **Page input**: Click on the page number to jump to a specific page
- **Zoom**: Use +/- buttons to zoom in/out
- **Options menu**: Click the dropdown arrow for view and fit mode options

## Compatibility

- Tested with Supernote A5X and A6X2 `.note` files
- Requires Obsidian v1.0.0 or higher

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Based on research from [supernote-tool](https://github.com/jya-dev/supernote-tool) for file format parsing

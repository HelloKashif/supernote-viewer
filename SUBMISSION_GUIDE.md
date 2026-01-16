# Obsidian Community Plugin Submission Guide

This guide explains how to submit Supernote to the Obsidian community plugins directory.

## Prerequisites

Before submitting, ensure you have:

1. **A public GitHub repository** with your plugin code
2. **All required files** in the repository root:
   - `main.js` - Compiled plugin code
   - `manifest.json` - Plugin metadata
   - `styles.css` - Plugin styles
   - `README.md` - Documentation
   - `LICENSE` - MIT license (or other open source license)
   - `versions.json` - Version compatibility mapping

3. **At least one GitHub Release** with the plugin files attached

## Step 1: Prepare Your Repository

### Verify manifest.json

Your `manifest.json` must include:

```json
{
  "id": "obsidian-supernote",
  "name": "Supernote",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "View and navigate Supernote .note files with thumbnails, zoom, and dark mode support.",
  "author": "Kashif",
  "authorUrl": "https://github.com/HelloKashif",
  "isDesktopOnly": false
}
```

**Important**: The `id`, `name`, and `description` must exactly match what you'll put in the community-plugins.json file.

### Verify versions.json

Your `versions.json` maps plugin versions to minimum Obsidian versions:

```json
{
  "1.0.0": "1.0.0"
}
```

This means plugin version 1.0.0 requires Obsidian 1.0.0 or higher.

## Step 2: Create a GitHub Release

1. **Build the plugin**:
   ```bash
   npm run build
   ```

2. **Create a git tag** (must match version in manifest.json exactly, no "v" prefix):
   ```bash
   git tag 1.0.0
   git push origin 1.0.0
   ```

3. **Create a release on GitHub**:
   - Go to your repository → Releases → "Create a new release"
   - Choose the tag `1.0.0`
   - Title: `1.0.0`
   - **Attach these files as binary assets**:
     - `main.js`
     - `manifest.json`
     - `styles.css`
   - Click "Publish release"

**Note**: If you've set up the GitHub Actions workflow (`.github/workflows/release.yml`), releases are created automatically when you push a tag. You just need to un-draft them.

## Step 3: Submit to Community Plugins

1. **Fork the obsidian-releases repository**:
   - Go to https://github.com/obsidianmd/obsidian-releases
   - Click "Fork" in the top right

2. **Edit community-plugins.json**:
   - In your fork, open `community-plugins.json`
   - Add your plugin entry **at the end** of the JSON array:

   ```json
   {
     "id": "obsidian-supernote",
     "name": "Supernote",
     "author": "Kashif",
     "description": "View and navigate Supernote .note files with thumbnails, zoom, and dark mode support.",
     "repo": "HelloKashif/obsidian-supernote"
   }
   ```

3. **Create a Pull Request**:
   - Go to the original obsidian-releases repository
   - Click "Pull requests" → "New pull request"
   - Click "compare across forks"
   - Select your fork and branch
   - Create the pull request

4. **Wait for Review**:
   - The Obsidian team and community will review your submission
   - A bot will verify that your manifest.json matches your submission
   - Address any feedback in the PR comments
   - Once merged, your plugin appears in the community plugins browser!

## Submission Requirements Checklist

Before submitting, verify:

- [ ] Plugin ID is unique (search community-plugins.json)
- [ ] Repository is public
- [ ] README.md exists and describes the plugin
- [ ] LICENSE file exists (MIT recommended)
- [ ] manifest.json has all required fields
- [ ] versions.json exists
- [ ] At least one GitHub release exists
- [ ] Release has main.js, manifest.json, and styles.css attached
- [ ] Tag version matches manifest.json version exactly (no "v" prefix)
- [ ] Plugin follows [Obsidian Developer Policies](https://docs.obsidian.md/Developer+policies)

## After Submission

### Announcing Your Plugin

Once accepted, you can announce your plugin:

1. **Obsidian Forum**: Post in the [Share & showcase](https://forum.obsidian.md/c/share-showcase/) category
2. **Discord**: Share in the `#updates` channel (requires developer role)
3. **Reddit**: Post in r/ObsidianMD

### Releasing Updates

For future updates:

1. Update version in `manifest.json` and `package.json`
2. Update `versions.json` if minimum Obsidian version changed
3. Build and commit changes
4. Create and push a new tag:
   ```bash
   git tag 1.0.1
   git push origin 1.0.1
   ```
5. Create a GitHub release with the new tag
6. Users will see the update in Obsidian automatically!

## Quick Commands Reference

```bash
# Bump patch version (1.0.0 → 1.0.1)
npm version patch

# Bump minor version (1.0.0 → 1.1.0)
npm version minor

# Bump major version (1.0.0 → 2.0.0)
npm version major

# Push tags to remote
git push --tags
```

## Useful Links

- [Official Submission Docs](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Submission Requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [obsidian-releases Repository](https://github.com/obsidianmd/obsidian-releases)
- [Developer Policies](https://docs.obsidian.md/Developer+policies)
- [Sample Plugin Template](https://github.com/obsidianmd/obsidian-sample-plugin)

## Troubleshooting

### "manifest.json not found" error
Ensure manifest.json is attached to your GitHub release as a binary asset, not just committed to the repo.

### Bot validation fails
The id, name, and description in your community-plugins.json entry must **exactly** match your manifest.json.

### Plugin not showing in search
After the PR is merged, it may take a few minutes for the plugin to appear. Try refreshing the community plugins browser.

### Users report download errors
Verify that all three files (main.js, manifest.json, styles.css) are attached to your GitHub release.

# PicZoomer - Image Zoom for Bluesky

PicZoomer adds mouse-wheel zooming and drag-to-pan controls to images opened in the [Bluesky](https://bsky.app/) web lightbox.

> PicZoomer is an independently developed third-party extension. It is not affiliated with, sponsored by, endorsed by, or officially connected to Bluesky Social PBC.

## Features

- Scroll the mouse wheel to zoom around the pointer.
- Drag the image to explore magnified details.
- Double-click the image to reset its scale and position.

## Install

### Chrome Web Store

The store link will be added after review.

### Developer Mode

1. Download and unzip the latest GitHub Release ZIP.
2. Open `chrome://extensions/` in Chrome.
3. Enable Developer mode.
4. Choose "Load unpacked" and select the unzipped extension folder.

## Privacy

PicZoomer does not collect, store, process, or transmit personal data.

- Runs only on `https://bsky.app/*`.
- Requests no Chrome extension API permissions.
- Contains no analytics, advertising, tracking, or remote code.

See [PRIVACY.md](PRIVACY.md) for the full privacy statement.

## Development

Requirements:

- Node.js
- Chrome or Chromium
- Playwright browser dependencies

Install dependencies and run tests:

```bash
npm ci
npx playwright install chromium
npm test
```

The tests run against a local lightbox fixture, so they do not require a Bluesky account, network access, or a proxy.

## Package

```bash
npm run package
```

The script validates the Manifest and release files, then creates:

```text
release/piczoomer-v1.0.0.zip
```

The release package contains only the runtime files required by the extension: Manifest, content script, and standard icon sizes.

Chrome Web Store listing assets are kept out of the public repository.

## License

[MIT License](LICENSE)

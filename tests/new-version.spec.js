const path = require('path');
const { test, expect } = require('@playwright/test');

const LIGHTBOX_IMAGE_SELECTOR = '[data-testid="lightbox-image"]';

const wideImage = makeSvgDataUrl(800, 200, '#2f8eff');
const tallImage = makeSvgDataUrl(200, 800, '#6ac5ff');

function makeSvgDataUrl(width, height, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="${width}" height="${height}" fill="${color}"/>
        <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#ffffff"/>
    </svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function createLightboxPage(page, imageSrc = wideImage) {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.setContent(`
        <!doctype html>
        <html>
            <head>
                <style>
                    body {
                        margin: 0;
                        background: #101318;
                    }

                    [role="dialog"] {
                        position: fixed;
                        inset: 0;
                        display: grid;
                        place-items: center;
                    }

                    .image-frame {
                        width: 600px;
                        height: 300px;
                    }

                    img[data-testid="lightbox-image"] {
                        width: 100%;
                        height: 100%;
                        object-fit: contain;
                        display: block;
                    }

                    button {
                        position: fixed;
                        top: 20px;
                        right: 20px;
                    }
                </style>
            </head>
            <body>
                <div role="dialog" aria-modal="true">
                    <button type="button">Close</button>
                    <div class="image-frame">
                        <img data-testid="lightbox-image" src="${imageSrc}" alt="Fixture image">
                    </div>
                </div>
            </body>
        </html>
    `);
    await page.addScriptTag({ path: path.resolve(__dirname, '..', 'content.js') });
    await page.waitForFunction((selector) => {
        const img = document.querySelector(selector);
        return !!img
            && img.dataset.zoomAttached === 'true'
            && !!document.getElementById('pz-lightbox-cursor-style');
    }, LIGHTBOX_IMAGE_SELECTOR);
}

async function zoomLightboxImageAt(page, point) {
    await page.evaluate(({ selector, targetPoint }) => {
        const img = document.querySelector(selector);
        const event = new WheelEvent('wheel', {
            deltaY: -500,
            clientX: targetPoint.x,
            clientY: targetPoint.y,
            bubbles: true,
            cancelable: true,
        });
        img.parentElement.dispatchEvent(event);
    }, { selector: LIGHTBOX_IMAGE_SELECTOR, targetPoint: point });
}

function computeRenderedImageBounds(rect, naturalWidth, naturalHeight) {
    const imgRatio = naturalWidth / naturalHeight;
    const boxRatio = rect.width / rect.height;
    let renderWidth;
    let renderHeight;

    if (imgRatio > boxRatio) {
        renderWidth = rect.width;
        renderHeight = rect.width / imgRatio;
    } else {
        renderHeight = rect.height;
        renderWidth = rect.height * imgRatio;
    }

    const left = rect.left + (rect.width - renderWidth) / 2;
    const top = rect.top + (rect.height - renderHeight) / 2;

    return {
        left,
        top,
        right: left + renderWidth,
        bottom: top + renderHeight,
    };
}

function pointInBounds(bounds, point) {
    return point.x >= bounds.left
        && point.x <= bounds.right
        && point.y >= bounds.top
        && point.y <= bounds.bottom;
}

test.describe('PicZoomer local fixture', () => {
    test('zooms, pans, and resets the lightbox image', async ({ page }) => {
        await createLightboxPage(page);

        const img = page.locator(LIGHTBOX_IMAGE_SELECTOR);
        const box = await img.boundingBox();
        const center = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
        };

        await zoomLightboxImageAt(page, center);
        await page.waitForTimeout(100);

        const transformAfterZoom = await img.evaluate((el) => el.style.transform);
        expect(transformAfterZoom).toContain('scale(');
        expect(Number(transformAfterZoom.match(/scale\(([^)]+)\)/)[1])).toBeGreaterThan(1);

        const transformBeforeDrag = await img.evaluate((el) => el.style.transform);
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
        await page.mouse.move(center.x + 100, center.y + 80);
        await page.mouse.up();
        await page.waitForTimeout(100);

        const transformAfterDrag = await img.evaluate((el) => el.style.transform);
        expect(transformAfterDrag).not.toBe(transformBeforeDrag);
        expect(transformAfterDrag).toContain('translate(');

        await img.dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
        await page.waitForFunction((selector) => {
            const img = document.querySelector(selector);
            return img?.style.transform === 'translate(0px, 0px) scale(1)';
        }, LIGHTBOX_IMAGE_SELECTOR);
    });

    test('keeps pointer states scoped to the rendered image and dialog controls', async ({ page }) => {
        await createLightboxPage(page);

        const img = page.locator(LIGHTBOX_IMAGE_SELECTOR);
        const box = await img.boundingBox();
        const center = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
        };

        await page.mouse.move(center.x, center.y);
        await expect(img).toHaveAttribute('data-pz-cursor-state', 'grab');

        await page.mouse.down();
        await expect(img).toHaveAttribute('data-pz-cursor-state', 'grabbing');
        await page.mouse.up();

        const pointerInfo = await page.evaluate((selector) => {
            const img = document.querySelector(selector);
            const root = img.closest('[role="dialog"], [aria-modal="true"]');
            const imgRect = img.getBoundingClientRect();
            const imgRatio = img.naturalWidth / img.naturalHeight;
            const boxRatio = imgRect.width / imgRect.height;
            let renderHeight;
            if (imgRatio > boxRatio) {
                renderHeight = imgRect.width / imgRatio;
            } else {
                renderHeight = imgRect.height;
            }
            const top = imgRect.top + (imgRect.height - renderHeight) / 2;
            const button = root.querySelector('button');

            return {
                outsidePoint: { x: imgRect.left + imgRect.width / 2, y: imgRect.top + 4 },
                isOutsideRenderedImage: imgRect.top + 4 < top,
                buttonCursor: getComputedStyle(button).cursor,
            };
        }, LIGHTBOX_IMAGE_SELECTOR);

        expect(pointerInfo.buttonCursor).toBe('pointer');
        expect(pointerInfo.isOutsideRenderedImage).toBe(true);

        await page.mouse.move(pointerInfo.outsidePoint.x, pointerInfo.outsidePoint.y);
        await expect(img).not.toHaveAttribute('data-pz-cursor-state');
    });

    test('cleans up state when the lightbox closes', async ({ page }) => {
        await createLightboxPage(page);

        await page.locator('[role="dialog"]').evaluate((dialog) => dialog.remove());

        await page.waitForFunction((selector) => {
            return !document.querySelector(selector)
                && !document.querySelector('[data-pz-lightbox-cursor-scope="true"]')
                && !document.querySelector('[data-pz-cursor-state]');
        }, LIGHTBOX_IMAGE_SELECTOR);
    });

    test('resets zoom when the image src changes', async ({ page }) => {
        await createLightboxPage(page);

        const img = page.locator(LIGHTBOX_IMAGE_SELECTOR);
        const box = await img.boundingBox();
        await zoomLightboxImageAt(page, {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
        });
        await page.waitForTimeout(100);

        const transformAfterZoom = await img.evaluate((el) => el.style.transform);
        expect(transformAfterZoom).not.toBe('translate(0px, 0px) scale(1)');

        await img.evaluate((el, nextSrc) => {
            el.setAttribute('src', nextSrc);
        }, tallImage);

        await page.waitForFunction((selector) => {
            const img = document.querySelector(selector);
            return !!img && img.style.transform === 'translate(0px, 0px) scale(1)';
        }, LIGHTBOX_IMAGE_SELECTOR);
    });

    test('ignores letterboxed areas outside the rendered image', () => {
        const rect = { left: 100, top: 100, width: 400, height: 300 };
        const bounds = computeRenderedImageBounds(rect, 4000, 500);
        const insidePoint = {
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
        };
        const outsidePoint = {
            x: (bounds.left + bounds.right) / 2,
            y: rect.top + 4,
        };

        expect(bounds.top).toBeGreaterThan(rect.top);
        expect(pointInBounds(bounds, insidePoint)).toBe(true);
        expect(pointInBounds(bounds, outsidePoint)).toBe(false);
    });
});

// ==========================================
// Constants and state
// ==========================================
const LIGHTBOX_IMAGE_SELECTOR = '[data-testid="lightbox-image"], [role="dialog"] img[src*="feed_fullsize"], [aria-modal="true"] img[src*="feed_fullsize"]';
const LIGHTBOX_ROOT_SELECTOR = '[role="dialog"], [aria-modal="true"]';
const TRANSITION_STYLE = 'transform 0.15s ease-out';
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const CURSOR_STYLE_ID = 'pz-lightbox-cursor-style';
const INTERACTIVE_ELEMENTS_SELECTOR = ':is(button, [role="button"], a[href], label, summary)';
const FORM_CONTROLS_SELECTOR = ':is(input, select, textarea)';

const state = {
  currentScale: 1,
  isDragging: false,
  startX: 0,
  startY: 0,
  translateX: 0,
  translateY: 0,
  currentImgElement: null,
  currentLightboxRoot: null,
  lastPointerX: 0,
  lastPointerY: 0,
  transformFrameId: 0,
  domSyncFrameId: 0,
};

// ==========================================
// Cursor scope
// ==========================================
function ensureCursorStyle() {
  if (document.getElementById(CURSOR_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = CURSOR_STYLE_ID;
  style.textContent = `
    [data-pz-lightbox-cursor-scope="true"],
    [data-pz-lightbox-cursor-scope="true"] * {
      cursor: default !important;
    }

    [data-pz-lightbox-cursor-scope="true"] ${INTERACTIVE_ELEMENTS_SELECTOR},
    [data-pz-lightbox-cursor-scope="true"] ${INTERACTIVE_ELEMENTS_SELECTOR} *,
    [data-pz-lightbox-cursor-scope="true"] ${FORM_CONTROLS_SELECTOR} {
      cursor: pointer !important;
    }

    [data-pz-lightbox-cursor-scope="true"] [data-pz-cursor-state="grab"] {
      cursor: grab !important;
    }

    [data-pz-lightbox-cursor-scope="true"] [data-pz-cursor-state="grabbing"] {
      cursor: grabbing !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function getLightboxImage() {
  return document.querySelector(LIGHTBOX_IMAGE_SELECTOR);
}

function getActiveImageForWrapper(wrapper) {
  const img = state.currentImgElement;
  return img && wrapper.contains(img) ? img : null;
}

function setImageCursorState(img, cursorState) {
  if (!img) return;

  if (cursorState) {
    img.dataset.pzCursorState = cursorState;
  } else {
    delete img.dataset.pzCursorState;
  }
}

function activateLightboxCursorScope(img) {
  ensureCursorStyle();

  const root = img.closest(LIGHTBOX_ROOT_SELECTOR);
  if (!root) return;

  if (state.currentLightboxRoot && state.currentLightboxRoot !== root) {
    delete state.currentLightboxRoot.dataset.pzLightboxCursorScope;
  }

  state.currentLightboxRoot = root;
  state.currentLightboxRoot.dataset.pzLightboxCursorScope = 'true';
}

function clearLightboxCursorScope() {
  if (!state.currentLightboxRoot) return;

  delete state.currentLightboxRoot.dataset.pzLightboxCursorScope;
  state.currentLightboxRoot = null;
}

// ==========================================
// Geometry and zoom calculations
// ==========================================
function isPointInRenderedImage(img, x, y) {
  const bounds = getRenderedImageBounds(img);
  if (!bounds) return true;

  return x >= bounds.left && x <= bounds.right
    && y >= bounds.top && y <= bounds.bottom;
}

// Map the rendered pixels of an object-fit: contain image back into screen-space bounds.
function getRenderedImageBounds(img) {
  if (!img.naturalWidth || !img.naturalHeight) return null;

  const rect = img.getBoundingClientRect();
  const imgRatio = img.naturalWidth / img.naturalHeight;
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

function clampScale(scale) {
  return Math.max(MIN_SCALE, Math.min(scale, MAX_SCALE));
}

function getZoomDelta(scale, event) {
  const baseStep = event.ctrlKey ? 0.04 : 0.2;
  return scale * baseStep;
}

function getNextScale(oldScale, event) {
  const zoomDelta = getZoomDelta(oldScale, event);

  if (event.deltaY < 0) {
    return clampScale(oldScale + zoomDelta);
  }

  return clampScale(oldScale - zoomDelta);
}

function readVisualTranslate(img) {
  const transform = window.getComputedStyle(img).transform;
  if (!transform || transform === 'none') {
    return { x: 0, y: 0 };
  }

  try {
    const matrix = new DOMMatrix(transform);
    return { x: matrix.e, y: matrix.f };
  } catch {
    return { x: 0, y: 0 };
  }
}

function updateImageCursorAtPoint(img, x, y) {
  setImageCursorState(img, isPointInRenderedImage(img, x, y) ? 'grab' : null);
}

function getZoomReference(img) {
  const rect = img.getBoundingClientRect();
  const visualTranslate = readVisualTranslate(img);

  return {
    rect,
    baseX: rect.left - visualTranslate.x,
    baseY: rect.top - visualTranslate.y,
  };
}

// Convert a screen-space pointer into image-local coordinates before the next scale is applied.
function getRelativeImagePoint({ baseX, baseY }, clientX, clientY, oldScale) {
  return {
    relX: (clientX - baseX - state.translateX) / oldScale,
    relY: (clientY - baseY - state.translateY) / oldScale,
  };
}

function getZoomTranslationDelta(relX, relY, oldScale, nextScale) {
  const deltaScale = nextScale - oldScale;

  return {
    deltaX: relX * deltaScale,
    deltaY: relY * deltaScale,
  };
}

// Keep the pixel under the cursor visually pinned while zoom changes.
function applyZoomDeltaAtPoint(relX, relY, oldScale, nextScale) {
  const { deltaX, deltaY } = getZoomTranslationDelta(relX, relY, oldScale, nextScale);

  state.translateX -= deltaX;
  state.translateY -= deltaY;

  if (state.isDragging) {
    state.startX -= deltaX;
    state.startY -= deltaY;
  }
}

// ==========================================
// View updates and lifecycle
// ==========================================
function scheduleTransformUpdate() {
  if (state.transformFrameId) return;

  // Coalesce bursts of drag/wheel updates into a single DOM write per frame.
  state.transformFrameId = requestAnimationFrame(() => {
    state.transformFrameId = 0;

    if (!state.currentImgElement) return;

    state.currentImgElement.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.currentScale})`;
  });
}

function resetZoom() {
  state.currentScale = 1;
  state.translateX = 0;
  state.translateY = 0;
  state.isDragging = false;

  if (!state.currentImgElement) return;

  state.currentImgElement.style.transition = TRANSITION_STYLE;
  setImageCursorState(state.currentImgElement, null);
  scheduleTransformUpdate();
}

function finishDragging() {
  if (!state.isDragging || !state.currentImgElement) return;

  state.isDragging = false;
  updateImageCursorAtPoint(state.currentImgElement, state.lastPointerX, state.lastPointerY);
  state.currentImgElement.style.transition = TRANSITION_STYLE;
}

function cleanupCurrentImage() {
  if (!state.currentImgElement) {
    srcObserver.disconnect();
    clearLightboxCursorScope();
    return;
  }

  resetZoom();
  srcObserver.disconnect();
  clearLightboxCursorScope();
  state.currentImgElement = null;
}

function handleWheel(wrapper, e) {
  const img = getActiveImageForWrapper(wrapper);
  if (!img || !isPointInRenderedImage(img, e.clientX, e.clientY)) return;

  e.preventDefault();

  const oldScale = state.currentScale;
  const nextScale = getNextScale(oldScale, e);

  if (nextScale === oldScale) return;

  const zoomReference = getZoomReference(img);
  const { relX, relY } = getRelativeImagePoint(zoomReference, e.clientX, e.clientY, oldScale);

  state.currentScale = nextScale;
  applyZoomDeltaAtPoint(relX, relY, oldScale, nextScale);

  scheduleTransformUpdate();
}

// ==========================================
// Image event binding
// ==========================================
function createImageMouseMoveHandler(img) {
  return (e) => {
    if (state.isDragging) return;

    updateImageCursorAtPoint(img, e.clientX, e.clientY);
  };
}

function createImageMouseLeaveHandler(img) {
  return () => {
    if (!state.isDragging) {
      setImageCursorState(img, null);
    }
  };
}

function createImageMouseDownHandler(img) {
  return (e) => {
    if (e.button !== 0 || !isPointInRenderedImage(img, e.clientX, e.clientY)) return;

    state.isDragging = true;
    state.startX = e.clientX - state.translateX;
    state.startY = e.clientY - state.translateY;
    setImageCursorState(img, 'grabbing');
    img.style.transition = 'none';
    e.preventDefault();
  };
}

function createImageClickHandler(img) {
  return (e) => {
    if (!isPointInRenderedImage(img, e.clientX, e.clientY)) return;

    e.stopPropagation();
    e.preventDefault();
  };
}

function createImageDoubleClickHandler(img) {
  return (e) => {
    if (!isPointInRenderedImage(img, e.clientX, e.clientY)) return;

    e.stopPropagation();
    e.preventDefault();
    resetZoom();
  };
}

function createWheelHandler(wrapper) {
  return (e) => {
    handleWheel(wrapper, e);
  };
}

// ==========================================
// Lightbox sync
// ==========================================
function attachZoomLogic(img, wrapper) {
  img.dataset.zoomAttached = 'true';
  activateLightboxCursorScope(img);

  img.style.transition = TRANSITION_STYLE;
  img.style.transformOrigin = '0 0';

  img.addEventListener('mousemove', createImageMouseMoveHandler(img));
  img.addEventListener('mouseleave', createImageMouseLeaveHandler(img));
  img.addEventListener('mousedown', createImageMouseDownHandler(img));
  img.addEventListener('click', createImageClickHandler(img), { capture: true });
  img.addEventListener('dblclick', createImageDoubleClickHandler(img));

  srcObserver.disconnect();
  srcObserver.observe(img, { attributes: true, attributeFilter: ['src'] });

  if (!wrapper.dataset.wheelAttached) {
    wrapper.dataset.wheelAttached = 'true';
    wrapper.addEventListener('wheel', createWheelHandler(wrapper), { passive: false });
  }
}

// React and Bluesky frequently rebuild lightbox nodes, so keep state for only the active image.
function syncLightboxState() {
  const img = getLightboxImage();

  if (!img) {
    cleanupCurrentImage();
    return;
  }

  if (img === state.currentImgElement) {
    activateLightboxCursorScope(img);
    return;
  }

  cleanupCurrentImage();

  const wrapper = img.parentElement;
  if (!wrapper) return;

  state.currentImgElement = img;
  attachZoomLogic(img, wrapper);
}

function scheduleLightboxSync() {
  if (state.domSyncFrameId) return;

  state.domSyncFrameId = requestAnimationFrame(() => {
    state.domSyncFrameId = 0;
    syncLightboxState();
  });
}

// ==========================================
// Observers and global events
// ==========================================
const srcObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
      resetZoom();
      return;
    }
  }
});

window.addEventListener('mousemove', (e) => {
  state.lastPointerX = e.clientX;
  state.lastPointerY = e.clientY;

  if (!state.isDragging || !state.currentImgElement) return;

  state.translateX = e.clientX - state.startX;
  state.translateY = e.clientY - state.startY;
  scheduleTransformUpdate();
});

window.addEventListener('mouseup', () => {
  finishDragging();
});

const domObserver = new MutationObserver(() => {
  scheduleLightboxSync();
});

domObserver.observe(document.body, { childList: true, subtree: true });
scheduleLightboxSync();

/**
 * Injected into the editor WebView once per page load.
 *
 * Controls provided:
 *  - Floating contextual menu pinned above/below the selected image
 *  - Bottom-right corner resize handle (clean rounded corner line in theme tint)
 *  - Permanent captions rendered below images (pure display, zero layout shift)
 *  - Block drag-and-drop between top-level blocks with drop indicator
 *  - Aggressive soft-keyboard suppression (disables contenteditable during drag/resize)
 */
export const IMAGE_TOOLS_JS = `
(function () {
  if (window.__melnoteImageToolsStarting) return;
  window.__melnoteImageToolsStarting = true;

  var selectedPos = null;
  var overlay = null;
  var handleSE = null;
  var floatingMenu = null;
  var resizeBadge = null;
  var captionsLayer = null;
  var indicator = null;
  var lastSelectionKey = '';
  var dragState = null;
  var resizeState = null;
  var pressCandidate = null;
  var menuVisible = false;

  function getEditor() {
    var pm = document.querySelector('.ProseMirror');
    return pm && pm.editor && pm.editor.view ? pm.editor : null;
  }

  function post(payload) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch (e) { /* native side gone */ }
  }

  function dismissKeyboard() {
    try {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      var pm = document.querySelector('.ProseMirror');
      if (pm && pm.blur) pm.blur();
    } catch (e) { }
    post({ type: 'melnote-dismiss-keyboard' });
  }

  function imageAt(ed, pos) {
    try {
      var node = ed.state.doc.nodeAt(pos);
      return node && node.type.name === 'image' ? node : null;
    } catch (e) { return null; }
  }

  function alignOf(node) {
    var code = Number(node.attrs.height);
    if (code === 1) return 'left';
    if (code === 3) return 'right';
    return 'center';
  }

  function widthOf(node) {
    var w = Number(node.attrs.width);
    if (!isFinite(w) || w < 20 || w > 100) return 100;
    return Math.round(w);
  }

  function imageElement(ed, pos) {
    try {
      var dom = ed.view.nodeDOM(pos);
      return dom && dom.nodeType === 1 ? dom : null;
    } catch (e) { return null; }
  }

  function findImagePos(ed, element) {
    var found = null;
    ed.state.doc.descendants(function (node, pos) {
      if (found !== null) return false;
      if (node.type.name === 'image' && imageElement(ed, pos) === element) {
        found = pos;
        return false;
      }
      return true;
    });
    return found;
  }

  /* ---------------------------------------------------------------- styles */

  function injectCSS() {
    if (document.getElementById('melnote-image-tools-css')) return;
    var style = document.createElement('style');
    style.id = 'melnote-image-tools-css';
    style.textContent = [
      '#melnote-image-overlay { position:absolute; left:0; top:0; width:100%; height:0; z-index:2147483645; pointer-events:none; }',
      '#melnote-captions-layer { position:absolute; left:0; top:0; width:100%; pointer-events:none; z-index:2147483640; }',
      '.melnote-corner-handle { position:absolute; width:44px; height:44px; display:flex; align-items:flex-end; justify-content:flex-end; pointer-events:auto; touch-action:none; z-index:2147483646; cursor:nwse-resize; -webkit-tap-highlight-color:transparent; }',
      '.melnote-corner-line { width:16px; height:16px; border-right:3.5px solid var(--melnote-tint, #B45309); border-bottom:3.5px solid var(--melnote-tint, #B45309); border-bottom-right-radius:8px; margin-right:3px; margin-bottom:3px; box-sizing:border-box; filter:drop-shadow(0 1px 3px rgba(0,0,0,0.45)); transition:transform 0.1s ease; }',
      '.melnote-corner-handle:active .melnote-corner-line { transform:scale(1.2); }',
      '.melnote-resize-badge { position:absolute; transform:translate(-50%, -50%); background:rgba(20,20,22,0.92); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); color:#ffffff; font:600 13px/18px -apple-system, Roboto, sans-serif; padding:4px 12px; border-radius:14px; box-shadow:0 4px 14px rgba(0,0,0,0.35); pointer-events:none; z-index:2147483647; display:none; }',
      '.melnote-floating-toolbar { position:absolute; display:flex; align-items:center; gap:2px; padding:4px 6px; background:rgba(28,28,30,0.95); backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); border-radius:22px; box-shadow:0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.12); pointer-events:auto; touch-action:manipulation; user-select:none; -webkit-user-select:none; white-space:nowrap; z-index:2147483647; transform:translateZ(0); }',
      '@keyframes melnote-toolbar-in { from { opacity:0; transform:scale(0.9) translateZ(0); } to { opacity:1; transform:scale(1) translateZ(0); } }',
      '.melnote-toolbar-enter { animation:melnote-toolbar-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); }',
      '.melnote-btn { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:10px; background:transparent; border:none; padding:0; margin:0; color:rgba(255,255,255,0.92); cursor:pointer; outline:none; -webkit-tap-highlight-color:transparent; transition:background-color 0.15s ease, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1); }',
      '.melnote-btn:active, .melnote-btn.melnote-pressed { background:rgba(255,255,255,0.18); transform:scale(0.9); }',
      '.melnote-btn.active { background:rgba(180,83,9,0.25); color:var(--melnote-tint, #B45309); }',
      '.melnote-btn.delete { color:#ff453a; }',
      '.melnote-btn.done { color:#30d158; }',
      '.melnote-sep { width:1px; height:18px; background:rgba(255,255,255,0.16); margin:0 3px; }',
      '.melnote-editor-caption { position:absolute; pointer-events:none !important; box-sizing:border-box; font:italic 13px/18px -apple-system, BlinkMacSystemFont, Figtree, Roboto, sans-serif; padding:2px 4px; white-space:normal; overflow-wrap:break-word; word-break:break-word; user-select:none; -webkit-user-select:none; color:var(--melnote-secondary, #8e8e93); z-index:2147483641; }'
    ].join('\\n');
    document.head.appendChild(style);
  }

  function paintImage(el, node, pos) {
    // While a corner-handle drag is in flight, the node attrs still hold the
    // old width. Repainting from the doc here (the ResizeObserver fires on
    // every height change) would snap the image back and kill the live
    // preview, so use the drag's preview width for that node instead.
    var width = (resizeState && resizeState.pos === pos)
      ? resizeState.previewWidth
      : widthOf(node);
    var align = alignOf(node);

    if (el.draggable) el.draggable = false;
    el.setAttribute('draggable', 'false');

    el.style.setProperty('width', width + '%', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-width', '100%', 'important');
    el.style.setProperty('display', 'block', 'important');
    el.style.setProperty('margin-top', '10px', 'important');
    // updateCaptions() reserves the wrapped caption height on top of this.
    el.style.setProperty('margin-bottom', '10px', 'important');

    if (align === 'left') {
      el.style.setProperty('margin-left', '0', 'important');
      el.style.setProperty('margin-right', 'auto', 'important');
    } else if (align === 'right') {
      el.style.setProperty('margin-left', 'auto', 'important');
      el.style.setProperty('margin-right', '0', 'important');
    } else {
      el.style.setProperty('margin-left', 'auto', 'important');
      el.style.setProperty('margin-right', 'auto', 'important');
    }

    if (!el.__melnoteLoadBound) {
      el.__melnoteLoadBound = true;
      el.addEventListener('load', function () {
        applyStyles();
      });
    }
  }

  function ensureCaptionsLayer() {
    injectCSS();
    if (!captionsLayer || !document.body.contains(captionsLayer)) {
      captionsLayer = document.createElement('div');
      captionsLayer.id = 'melnote-captions-layer';
      document.body.appendChild(captionsLayer);
    }
    return captionsLayer;
  }

  function updateCaptions(ed) {
    var layer = ensureCaptionsLayer();

    var livePositions = {};
    ed.state.doc.descendants(function (node, pos) {
      if (node.type.name === 'image') livePositions[pos] = true;
    });

    var existing = layer.querySelectorAll('.melnote-editor-caption');
    for (var i = 0; i < existing.length; i++) {
      var p = Number(existing[i].getAttribute('data-pos'));
      if (!livePositions[p]) {
        existing[i].remove();
      }
    }

    ed.state.doc.descendants(function (node, pos) {
      if (node.type.name !== 'image') return;
      var el = imageElement(ed, pos);
      if (!el) return;

      var title = node.attrs.title ? String(node.attrs.title).trim() : '';
      if (!title) {
        var stale = layer.querySelector('.melnote-editor-caption[data-pos="' + pos + '"]');
        if (stale) stale.remove();
        return;
      }

      var capEl = layer.querySelector('.melnote-editor-caption[data-pos="' + pos + '"]');
      if (!capEl) {
        capEl = document.createElement('div');
        capEl.className = 'melnote-editor-caption';
        capEl.setAttribute('data-pos', String(pos));
        layer.appendChild(capEl);
      }

      var rect = el.getBoundingClientRect();
      var align = alignOf(node);
      var left = rect.left + window.scrollX;
      var top = rect.top + window.scrollY + rect.height + 4;

      capEl.style.left = left + 'px';
      capEl.style.top = top + 'px';
      capEl.style.width = Math.max(60, rect.width) + 'px';
      capEl.style.textAlign = align;
      capEl.textContent = title;

      // Captions wrap (matching the reader), so reserve the measured height
      // instead of paintImage's one-line margin - otherwise a long caption
      // prints on top of the following block.
      var capHeight = 0;
      try { capHeight = capEl.offsetHeight; } catch (e) { }
      if (capHeight > 0) {
        el.style.setProperty('margin-bottom', (10 + capHeight + 6) + 'px', 'important');
      }
    });
  }

  function applyStyles() {
    var ed = getEditor();
    if (!ed) return;
    ed.state.doc.descendants(function (node, pos) {
      if (node.type.name !== 'image') return;
      var el = imageElement(ed, pos);
      if (el) paintImage(el, node, pos);
    });
    updateCaptions(ed);
    positionOverlay();
  }

  /* --------------------------------------------------------------- overlay */

  function buildSVG(pathD, isStroke, strokeWidth) {
    if (isStroke) {
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (strokeWidth || 2) + '" stroke-linecap="round" stroke-linejoin="round">' + pathD + '</svg>';
    }
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">' + pathD + '</svg>';
  }

  function ensureOverlay() {
    ensureCaptionsLayer();
    if (overlay && document.body.contains(overlay)) return;
    overlay = document.createElement('div');
    overlay.id = 'melnote-image-overlay';

    // Single bottom-right corner resize handle
    handleSE = document.createElement('div');
    handleSE.className = 'melnote-corner-handle';
    handleSE.setAttribute('data-corner', 'se');
    handleSE.innerHTML = '<div class="melnote-corner-line"></div>';
    handleSE.addEventListener('pointerdown', onCornerHandleDown);
    overlay.appendChild(handleSE);

    // Floating contextual menu
    floatingMenu = document.createElement('div');
    floatingMenu.className = 'melnote-floating-toolbar';
    floatingMenu.innerHTML = [
      '<button type="button" class="melnote-btn" data-action="align-left" title="Align left">' +
        buildSVG('<path d="M3 4h18v2H3V4zm0 5h12v2H3V9zm0 5h18v2H3v-2zm0 5h12v2H3v-2z"/>') +
      '</button>',
      '<button type="button" class="melnote-btn" data-action="align-center" title="Align center">' +
        buildSVG('<path d="M3 4h18v2H3V4zm3 5h12v2H6V9zm-3 5h18v2H3v-2zm3 5h12v2H6v-2z"/>') +
      '</button>',
      '<button type="button" class="melnote-btn" data-action="align-right" title="Align right">' +
        buildSVG('<path d="M3 4h18v2H3V4zm6 5h12v2H9V9zm-6 5h18v2H3v-2zm6 5h12v2H9v-2z"/>') +
      '</button>',
      '<div class="melnote-sep"></div>',
      '<button type="button" class="melnote-btn" data-action="edit" title="Edit">' +
        buildSVG('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>', true, 2) +
      '</button>',
      '<button type="button" class="melnote-btn" data-action="caption" title="Caption">' +
        buildSVG('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/>', true, 2) +
      '</button>',
      '<button type="button" class="melnote-btn" data-action="replace" title="Replace">' +
        buildSVG('<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>', true, 2) +
      '</button>',
      '<button type="button" class="melnote-btn delete" data-action="delete" title="Delete">' +
        buildSVG('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', true, 2) +
      '</button>',
      '<div class="melnote-sep"></div>',
      '<button type="button" class="melnote-btn done" data-action="done" title="Done">' +
        buildSVG('<polyline points="20 6 9 17 4 12"/>', true, 2.5) +
      '</button>'
    ].join('');

    // Android WebView suppresses the synthetic click event that follows a
    // preventDefault()-ed pointerdown, so actions fire on pointerup instead.
    // :active is unreliable here too, so the pressed scale is class-driven.
    var menuPressAction = null;

    function releaseMenuPress() {
      menuPressAction = null;
      var pressedBtns = floatingMenu.querySelectorAll('.melnote-btn.melnote-pressed');
      for (var i = 0; i < pressedBtns.length; i++) {
        pressedBtns[i].classList.remove('melnote-pressed');
      }
    }

    floatingMenu.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dismissKeyboard();
      var btn = e.target.closest('[data-action]');
      menuPressAction = btn ? btn.getAttribute('data-action') : null;
      if (btn) btn.classList.add('melnote-pressed');
    });

    floatingMenu.addEventListener('pointerup', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dismissKeyboard();
      var pressed = menuPressAction;
      var btn = e.target.closest('[data-action]');
      releaseMenuPress();
      if (!btn || !pressed || btn.getAttribute('data-action') !== pressed) return;
      if (pressed === 'align-left') {
        window.melnoteImageUpdate({ height: 1 });
      } else if (pressed === 'align-center') {
        window.melnoteImageUpdate({ height: 2 });
      } else if (pressed === 'align-right') {
        window.melnoteImageUpdate({ height: 3 });
      } else if (pressed === 'done') {
        window.melnoteImageDeselect();
      } else {
        post({ type: 'melnote-image-action', action: pressed });
      }
    });

    floatingMenu.addEventListener('pointercancel', function () {
      releaseMenuPress();
    });

    floatingMenu.addEventListener('pointerleave', function () {
      releaseMenuPress();
    });

    overlay.appendChild(floatingMenu);

    // Live resize percentage badge
    resizeBadge = document.createElement('div');
    resizeBadge.className = 'melnote-resize-badge';
    overlay.appendChild(resizeBadge);

    document.body.appendChild(overlay);

    // Drag-and-drop indicator line
    indicator = document.createElement('div');
    indicator.id = 'melnote-drop-indicator';
    indicator.style.cssText = 'position:fixed;height:3px;border-radius:2px;display:none;' +
      'background:var(--melnote-tint, #B45309);box-shadow:0 0 0 1px rgba(255,255,255,0.55);' +
      'pointer-events:none;z-index:2147483646;';
    document.body.appendChild(indicator);
  }

  function positionOverlay() {
    if (selectedPos == null) return;
    var ed = getEditor();
    if (!ed) return;
    var el = imageElement(ed, selectedPos);
    var node = imageAt(ed, selectedPos);
    if (!el || !node) { hideOverlay(); return; }

    ensureOverlay();
    var rect = el.getBoundingClientRect();
    var left = rect.left + window.scrollX;
    var top = rect.top + window.scrollY;
    var width = rect.width;
    var height = rect.height;

    // 1. Bottom-right corner handle
    var isBusy = !!(resizeState || dragState);
    handleSE.style.display = isBusy ? 'none' : 'flex';
    handleSE.style.left = (left + width - 44) + 'px';
    handleSE.style.top = (top + height - 44) + 'px';

    // 2. Floating menu
    if (isBusy) {
      floatingMenu.style.display = 'none';
      menuVisible = false;
    } else {
      floatingMenu.style.display = 'flex';
      if (!menuVisible) {
        // Pop in like the app's native contextual sheets (spring-ish overshoot).
        menuVisible = true;
        floatingMenu.classList.remove('melnote-toolbar-enter');
        void floatingMenu.offsetWidth;
        floatingMenu.classList.add('melnote-toolbar-enter');
      }
      var align = alignOf(node);
      var btns = floatingMenu.querySelectorAll('.melnote-btn[data-action^="align-"]');
      for (var b = 0; b < btns.length; b++) {
        var act = btns[b].getAttribute('data-action');
        btns[b].classList.toggle('active', act === 'align-' + align);
      }

      var menuW = floatingMenu.offsetWidth || 320;
      var menuH = floatingMenu.offsetHeight || 42;
      var viewW = document.documentElement.clientWidth || window.innerWidth;
      var viewH = window.innerHeight;
      var margin = 8;
      var hasCaption = !!(node.attrs.title && String(node.attrs.title).trim().length > 0);
      var gap = hasCaption ? 32 : 10;

      // Prefer the roomier side, then clamp into the visible viewport so the
      // menu stays reachable for images taller than the screen.
      var spaceAbove = rect.top;
      var spaceBelow = viewH - rect.bottom;
      var menuViewportTop = (spaceBelow >= menuH + gap + margin || spaceBelow >= spaceAbove)
        ? rect.bottom + gap
        : rect.top - menuH - gap;
      menuViewportTop = Math.max(margin, Math.min(viewH - menuH - margin, menuViewportTop));
      var menuTop = menuViewportTop + window.scrollY;

      var centerX = rect.left + (width / 2);
      var menuViewportLeft = Math.max(10, Math.min(viewW - menuW - 10, centerX - (menuW / 2)));
      var menuLeft = menuViewportLeft + window.scrollX;

      floatingMenu.style.top = menuTop + 'px';
      floatingMenu.style.left = menuLeft + 'px';
    }

    // 3. Live resize badge
    if (resizeState) {
      resizeBadge.style.display = 'block';
      resizeBadge.style.left = (left + width / 2) + 'px';
      resizeBadge.style.top = (top + height / 2) + 'px';
      resizeBadge.textContent = resizeState.previewWidth + '%';
    } else {
      resizeBadge.style.display = 'none';
    }

    overlay.style.display = 'block';
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
    if (indicator) indicator.style.display = 'none';
    menuVisible = false;
  }

  function showOverlay(pos) {
    selectedPos = pos;
    positionOverlay();
  }

  /* ------------------------------------------------------------ selection */

  function notifySelection(force) {
    var ed = getEditor();
    if (!ed) return;
    var sel = ed.state.selection;
    var active = !!(sel && sel.node && sel.node.type && sel.node.type.name === 'image');
    var payload = active
      ? {
          active: true,
          pos: sel.from,
          src: sel.node.attrs.src || '',
          width: widthOf(sel.node),
          align: alignOf(sel.node),
          caption: sel.node.attrs.title || ''
        }
      : { active: false };

    var key = JSON.stringify(payload);
    if (!force && key === lastSelectionKey) return;
    lastSelectionKey = key;

    if (active) {
      showOverlay(sel.from);
      dismissKeyboard();
    } else {
      selectedPos = null;
      hideOverlay();
    }
    post({ type: 'melnote-image-selection', value: payload });
  }

  /* --------------------------------------------------------------- resize */

  function onCornerHandleDown(event) {
    event.preventDefault();
    event.stopPropagation();
    dismissKeyboard();

    var ed = getEditor();
    if (!ed || selectedPos == null) return;
    var node = imageAt(ed, selectedPos);
    var el = imageElement(ed, selectedPos);
    if (!node || !el) return;

    var rect = el.getBoundingClientRect();
    var container = rect.width;
    try {
      var parent = el.parentElement;
      if (parent) {
        var styles = getComputedStyle(parent);
        var padLeft = parseFloat(styles.paddingLeft) || 0;
        var padRight = parseFloat(styles.paddingRight) || 0;
        container = parent.clientWidth - padLeft - padRight;
      }
    } catch (e) { }
    if (!container || container < 40) container = rect.width;

    var pm = document.querySelector('.ProseMirror');
    if (pm) pm.setAttribute('contenteditable', 'false');

    resizeState = {
      pos: selectedPos,
      el: el,
      startX: event.clientX,
      startWidth: rect.width,
      container: container,
      previewWidth: widthOf(node)
    };
    positionOverlay();
  }

  function handleResizeMove(event) {
    if (!resizeState) return;
    var delta = event.clientX - resizeState.startX;
    var pct = Math.round(((resizeState.startWidth + delta) / resizeState.container) * 100);
    pct = Math.max(20, Math.min(100, pct));
    if (pct === resizeState.previewWidth) return;
    resizeState.previewWidth = pct;
    resizeState.el.style.setProperty('width', pct + '%', 'important');
    positionOverlay();
  }

  function finishResize() {
    if (!resizeState) return;
    var state = resizeState;
    resizeState = null;

    var pm = document.querySelector('.ProseMirror');
    if (pm) pm.setAttribute('contenteditable', 'true');

    var ed = getEditor();
    if (!ed) return;
    var node = imageAt(ed, state.pos);
    if (node && widthOf(node) !== state.previewWidth) {
      var attrs = Object.assign({}, node.attrs, { width: state.previewWidth });
      ed.view.dispatch(ed.state.tr.setNodeMarkup(state.pos, null, attrs));
    }
    positionOverlay();
  }

  /* ----------------------------------------------------------- drag & drop */

  function cancelPress() {
    if (pressCandidate) {
      clearTimeout(pressCandidate.timer);
      pressCandidate = null;
    }
  }

  function onDocPointerDown(event) {
    if (resizeState || event.button !== 0) return;
    var target = event.target;
    if (!target) return;

    // Image tapped
    if (target.tagName === 'IMG') {
      if (target.classList && target.classList.contains('ProseMirror-separator')) return;
      event.preventDefault();
      event.stopPropagation();
      dismissKeyboard();

      var ed = getEditor();
      if (ed) {
        var pos = findImagePos(ed, target);
        if (pos != null) {
          try { ed.chain().setNodeSelection(pos).run(); } catch (e) { }
        }
      }

      cancelPress();
      pressCandidate = {
        el: target,
        x: event.clientX,
        y: event.clientY,
        timer: setTimeout(function () {
          var candidate = pressCandidate;
          pressCandidate = null;
          if (candidate) beginDrag(candidate);
        }, 360)
      };
      return;
    }

    // Tapping elsewhere in document while image is selected -> deselect
    if (selectedPos != null && !target.closest('#melnote-image-overlay')) {
      window.melnoteImageDeselect();
    }
  }

  function beginDrag(candidate) {
    var ed = getEditor();
    if (!ed) return;
    var pos = findImagePos(ed, candidate.el);
    if (pos == null) return;
    var node = imageAt(ed, pos);
    if (!node) return;

    dismissKeyboard();
    var pm = document.querySelector('.ProseMirror');
    if (pm) pm.setAttribute('contenteditable', 'false');

    var rect = candidate.el.getBoundingClientRect();
    var clone = candidate.el.cloneNode(true);
    clone.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;' +
      'left:' + rect.left + 'px;top:' + rect.top + 'px;height:auto;opacity:0.92;' +
      'border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,0.35);transform:scale(0.96);';
    // The editor stylesheet forces every img to width:100% !important, which
    // would blow the clone up to full width even when the image is set to
    // 50/75%. Re-assert the rendered box with !important so the drag ghost
    // matches the image the user grabbed.
    clone.style.setProperty('width', rect.width + 'px', 'important');
    clone.style.setProperty('max-width', 'none', 'important');
    clone.style.setProperty('margin', '0', 'important');
    document.body.appendChild(clone);

    dragState = {
      pos: pos,
      node: node,
      el: candidate.el,
      clone: clone,
      startX: candidate.x,
      startY: candidate.y,
      drop: null,
      lastY: candidate.y
    };
    candidate.el.style.opacity = '0.22';
    document.body.classList.add('melnote-image-dragging');
    hideOverlay();
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { } }
  }

  function computeDrop(x, y) {
    var ed = getEditor();
    if (!ed) return null;
    var coords = ed.view.posAtCoords({ left: x, top: y });
    if (!coords) return null;
    var doc = ed.state.doc;
    var pos = Math.max(0, Math.min(coords.pos, doc.content.size));

    var start = 0;
    var end = 0;
    var offset = 0;
    var found = false;
    for (var i = 0; i < doc.childCount; i++) {
      var child = doc.child(i);
      var childEnd = offset + child.nodeSize;
      if (pos < childEnd || i === doc.childCount - 1) {
        start = offset;
        end = childEnd;
        found = true;
        break;
      }
      offset = childEnd;
    }
    if (!found) return null;

    var dom = ed.view.nodeDOM(start);
    var el = dom && dom.nodeType === 1 ? dom : (dom && dom.parentElement ? dom.parentElement : null);
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var after = y > rect.top + rect.height / 2;
    return {
      pos: after ? end : start,
      top: after ? rect.bottom : rect.top,
      left: rect.left,
      width: rect.width,
      isSelf: start === dragState.pos
    };
  }

  function updateIndicator(drop) {
    if (!indicator) return;
    if (!drop || drop.isSelf) {
      indicator.style.display = 'none';
      return;
    }
    indicator.style.display = 'block';
    indicator.style.left = drop.left + 'px';
    indicator.style.width = drop.width + 'px';
    indicator.style.top = (drop.top - 1.5) + 'px';
  }

  function moveDrag(event) {
    var dx = event.clientX - dragState.startX;
    var dy = event.clientY - dragState.startY;
    var rect = dragState.el.getBoundingClientRect();
    dragState.clone.style.left = (rect.left + dx) + 'px';
    dragState.clone.style.top = (rect.top + dy) + 'px';

    var viewportY = event.clientY;
    if (viewportY < 90) window.scrollBy(0, -12);
    else if (viewportY > window.innerHeight - 90) window.scrollBy(0, 12);

    dragState.drop = computeDrop(event.clientX, viewportY);
    updateIndicator(dragState.drop);
  }

  function finishDrag() {
    var state = dragState;
    dragState = null;
    document.body.classList.remove('melnote-image-dragging');
    var pm = document.querySelector('.ProseMirror');
    if (pm) pm.setAttribute('contenteditable', 'true');
    dismissKeyboard();
    if (!state) return;

    try { state.clone.remove(); } catch (e) { }
    state.el.style.opacity = '';

    var ed = getEditor();
    if (!ed || !state.drop || state.drop.isSelf) {
      updateIndicator(null);
      notifySelection(true);
      return;
    }

    var node = imageAt(ed, state.pos);
    if (!node) { updateIndicator(null); return; }

    var tr = ed.state.tr.delete(state.pos, state.pos + node.nodeSize);
    var target = state.drop.pos;
    if (target > state.pos) target -= node.nodeSize;
    target = Math.max(0, Math.min(target, tr.doc.content.size));
    tr.insert(target, node);

    if (target + node.nodeSize >= tr.doc.content.size) {
      var paragraph = ed.state.schema.nodes.paragraph;
      if (paragraph) tr.insert(tr.doc.content.size, paragraph.create());
    }

    ed.view.dispatch(tr);
    try { ed.chain().setNodeSelection(target).run(); } catch (e) { }
    updateIndicator(null);
  }

  /* ----------------------------------------------------------- native API */

  window.melnoteImageUpdate = function (attrs, posHint) {
    var ed = getEditor();
    if (!ed) return;
    var pos = selectedPos;
    var node = pos == null ? null : imageAt(ed, pos);
    var usedHint = false;
    // Native modals can blur the WebView and clear its selection; fall back to
    // the position native pinned when the toolbar was opened.
    if (!node && posHint != null) {
      var hinted = imageAt(ed, posHint);
      if (hinted) { pos = posHint; node = hinted; usedHint = true; }
    }
    if (!node) {
      var sel = ed.state.selection;
      if (sel && sel.node && sel.node.type && sel.node.type.name === 'image') {
        pos = sel.from;
        node = sel.node;
      }
    }
    if (!node) return;
    var next = Object.assign({}, node.attrs, attrs);
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, null, next));
    // Restore the image selection the modal stole so the floating menu comes
    // back when it closes.
    if (usedHint) {
      try { ed.chain().setNodeSelection(pos).run(); } catch (e) { }
    }
    applyStyles();
    notifySelection(true);
  };

  window.melnoteImageDelete = function (posHint) {
    var ed = getEditor();
    if (!ed) return;
    var pos = selectedPos;
    var node = pos == null ? null : imageAt(ed, pos);
    if (!node && posHint != null) {
      var hinted = imageAt(ed, posHint);
      if (hinted) { pos = posHint; node = hinted; }
    }
    if (!node) {
      var sel = ed.state.selection;
      if (sel && sel.node && sel.node.type && sel.node.type.name === 'image') {
        pos = sel.from;
        node = sel.node;
      }
    }
    if (!node) return;
    ed.view.dispatch(ed.state.tr.delete(pos, pos + node.nodeSize));
    selectedPos = null;
    hideOverlay();
    applyStyles();
  };

  window.melnoteImageDeselect = function () {
    var ed = getEditor();
    var pos = selectedPos;
    selectedPos = null;
    hideOverlay();
    applyStyles();
    if (!ed) return;
    try {
      var size = ed.state.doc.content.size;
      var target = pos == null ? Math.min(1, size) : Math.min(pos + 2, size);
      ed.commands.setTextSelection(target);
    } catch (e) { }
  };

  /* --------------------------------------------------------------- global */

  function onPointerMove(event) {
    if (pressCandidate) {
      var dx = event.clientX - pressCandidate.x;
      var dy = event.clientY - pressCandidate.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancelPress();
    }
    if (resizeState) { handleResizeMove(event); return; }
    if (dragState) {
      event.preventDefault();
      moveDrag(event);
    }
  }

  function onPointerUp() {
    cancelPress();
    if (resizeState) { finishResize(); return; }
    if (dragState) finishDrag();
  }

  function onPointerCancel() {
    cancelPress();
    if (resizeState) { finishResize(); return; }
    if (dragState) {
      var state = dragState;
      dragState = null;
      try { state.clone.remove(); } catch (e) { }
      state.el.style.opacity = '';
      document.body.classList.remove('melnote-image-dragging');
      var pm = document.querySelector('.ProseMirror');
      if (pm) pm.setAttribute('contenteditable', 'true');
      dismissKeyboard();
      updateIndicator(null);
    }
  }

  function install() {
    var ed = getEditor();
    if (!ed) { setTimeout(install, 80); return; }
    if (ed.view.__melnoteImageTools) {
      applyStyles();
      notifySelection(true);
      return;
    }
    ed.view.__melnoteImageTools = true;

    var originalDispatch = ed.view.dispatch.bind(ed.view);
    ed.view.dispatch = function (tr) {
      var result = originalDispatch(tr);
      try {
        applyStyles();
        notifySelection(false);
      } catch (e) { /* never break a transaction */ }
      return result;
    };

    document.addEventListener('selectionchange', function () {
      try { notifySelection(false); } catch (e) { }
    });
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('touchstart', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.tagName === 'IMG' || (target.closest && target.closest('#melnote-image-overlay'))) {
        dismissKeyboard();
      }
    }, { capture: true, passive: true });
    document.addEventListener('contextmenu', function (event) {
      if (event.target && event.target.tagName === 'IMG') event.preventDefault();
    }, true);
    document.addEventListener('dragstart', function (event) {
      if (event.target && event.target.tagName === 'IMG') event.preventDefault();
    }, true);
    document.addEventListener('touchmove', function (event) {
      if (dragState || resizeState) event.preventDefault();
    }, { passive: false });
    window.addEventListener('scroll', function () {
      positionOverlay();
      var ed2 = getEditor();
      if (ed2) updateCaptions(ed2);
    }, true);
    window.addEventListener('resize', function () {
      positionOverlay();
      var ed2 = getEditor();
      if (ed2) updateCaptions(ed2);
    });

    // Auto-update captions whenever DOM mutations or image loads change element layout
    if (window.ResizeObserver) {
      try {
        var ro = new ResizeObserver(function () {
          applyStyles();
        });
        var pmEl = document.querySelector('.ProseMirror');
        if (pmEl) ro.observe(pmEl);
      } catch (e) { }
    }

    applyStyles();
    notifySelection(true);
    setTimeout(applyStyles, 100);
    setTimeout(applyStyles, 400);
  }

  install();
})();
true;
`;

// focus-carousel.js: the picture carousel, built once.
//
// When someone has saved more than one detox day picture, they play as a
// gallery. Three places draw it, so none keeps its own copy:
//
//   extension/popup/popup.js           the call over the popup when Start is pressed
//   extension/content/focus-break.js   the break screen on every web page
//   extension/focus/photo.js           the page where the pictures are chosen
//
// create(urls, opts) returns an element that fills whatever it is put in: the
// caller sizes the parent. The element carries its own <style>, so it works in
// the page, in the popup and inside a shadow root alike, and every class starts
// with sbc-. Colours come from the design tokens, which reach into a shadow
// root through inheritance.
//
// Every picture shows whole, never cropped: a tall family photo keeps every
// head. What the picture does not cover is filled with a soft, blurred copy of
// it, so the frame never shows bare bands.
//
// One picture is just a picture: no arrows, no dots, nothing moving. With more,
// the gallery advances by itself every 7 seconds. It stops while the controls
// are in use, when the person presses Pause, and always when their system asks
// for less motion (they can still press Play). Left and Right arrow keys step
// through it.
(function(root) {
  'use strict';

  var AUTOPLAY_MS = 7000;

  var CSS =
    '.sbc{position:relative;width:100%;height:100%;overflow:hidden;background:var(--sb-ink)}' +
    '.sbc[hidden]{display:none}' +
    '.sbc-slide{position:absolute;inset:0;overflow:hidden;opacity:0;transition:opacity 600ms var(--sb-ease)}' +
    '.sbc-slide.on{opacity:1}' +
    '.sbc-fill,.sbc-pic{position:absolute;inset:0;width:100%;height:100%}' +
    '.sbc-fill{object-fit:cover;filter:blur(34px);transform:scale(1.2);opacity:.55}' +
    '.sbc-pic{object-fit:contain}' +
    '.sbc-bar{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:4px;' +
      'max-width:calc(100% - 32px);border-radius:var(--sb-r-pill);background:var(--sb-toast-bg)}' +
    '.sbc-btn{width:36px;height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0;border:0;' +
      'border-radius:var(--sb-r-pill);background:none;color:var(--sb-bg);cursor:pointer;transition:background var(--sb-dur-fast)}' +
    '.sbc-btn:hover{background:var(--sb-ink-muted)}' +
    '.sbc-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}' +
    '.sbc-dots{display:flex;align-items:center}' +
    '.sbc-dot{position:relative;width:24px;height:24px;padding:0;border:0;border-radius:var(--sb-r-pill);background:none;cursor:pointer}' +
    '.sbc-dot::before{content:"";position:absolute;top:50%;left:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;' +
      'background:var(--sb-bg);opacity:.45;transition:opacity var(--sb-dur-base)}' +
    '.sbc-dot[aria-current="true"]::before{opacity:1}' +
    '.sbc-btn:focus-visible,.sbc-dot:focus-visible{outline:2px solid var(--sb-bg);outline-offset:-2px}' +
    '@media (prefers-reduced-motion:reduce){.sbc-slide{transition:none}}';

  var ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="9" y1="6" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="18"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 5 19 12 8 19 8 5"/></svg>';

  // The picture after (dir 1) or before (dir -1) this one, wrapping round at
  // both ends. An index that is not in range counts as the first picture.
  function inRange(index, count) {
    var i = Math.floor(Number(index));
    return isFinite(i) && i >= 0 && i < count;
  }

  function stepIndex(index, count, dir) {
    var n = Math.floor(count);
    if (!(n > 0)) return 0;
    var i = inRange(index, n) ? Math.floor(Number(index)) : 0;
    return (i + (dir < 0 ? -1 : 1) + n) % n;
  }

  function slideLabel(index, count) {
    return 'Picture ' + (index + 1) + ' of ' + count;
  }

  function button(doc, className, label, html) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = className;
    b.setAttribute('aria-label', label);
    if (html) b.innerHTML = html;
    return b;
  }

  /**
   * @param {string[]} urls   picture addresses, in the order to show them
   * @param {object} [opts]   start: the first picture shown; doc: the document
   *                          to build in; onFail: called if no picture can load
   * @returns {object|null}   null for an empty list, else
   *   { el, count, index(), go(i), step(dir), handleKey(e), destroy() }
   */
  function create(urls, opts) {
    var o = opts || {};
    var doc = o.doc || root.document;
    var list = (Array.isArray(urls) ? urls : []).filter(function(u) { return typeof u === 'string' && u; });
    var n = list.length;
    if (!n) return null;

    var index = inRange(o.start, n) ? Math.floor(Number(o.start)) : 0;
    var reduce = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var userPaused = reduce;
    var hold = false;
    var timer = null;
    var failed = 0;

    var el = doc.createElement('div');
    el.className = 'sbc';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-roledescription', 'carousel');
    el.setAttribute('aria-label', 'Your pictures');

    var style = doc.createElement('style');
    style.textContent = CSS;
    el.appendChild(style);

    var stage = doc.createElement('div');
    stage.style.cssText = 'position:absolute;inset:0';
    el.appendChild(stage);

    // Each slide is the blurred fill behind the whole picture. Only the picture
    // is read aloud, and only its failure to load counts.
    var slides = list.map(function(url, i) {
      var slide = doc.createElement('div');
      slide.className = 'sbc-slide';
      var fill = doc.createElement('img');
      fill.className = 'sbc-fill';
      fill.alt = '';
      fill.src = url;
      slide.appendChild(fill);
      var img = doc.createElement('img');
      img.className = 'sbc-pic';
      img.alt = slideLabel(i, n);
      img.addEventListener('error', function() {
        failed++;
        if (failed === n) {
          el.hidden = true;
          stop();
          if (typeof o.onFail === 'function') o.onFail();
        }
      });
      img.src = url;
      slide.appendChild(img);
      stage.appendChild(slide);
      return slide;
    });

    var dots = [];
    var pauseBtn = null;

    function playing() { return n > 1 && !userPaused && !hold && !el.hidden; }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    // Starts or stops the automatic advance to match the state. A gallery that
    // moves by itself must not announce each picture, one that does not may.
    function sync() {
      if (playing()) {
        if (!timer) timer = setInterval(function() { show(stepIndex(index, n, 1)); }, AUTOPLAY_MS);
      } else {
        stop();
      }
      stage.setAttribute('aria-live', timer ? 'off' : 'polite');
    }

    function show(i) {
      index = i;
      slides.forEach(function(slide, k) {
        slide.classList.toggle('on', k === i);
        if (k === i) slide.removeAttribute('aria-hidden'); else slide.setAttribute('aria-hidden', 'true');
      });
      dots.forEach(function(d, k) { d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    }

    // A person moving by hand restarts the wait, so it never jumps right after.
    function go(i) {
      show(inRange(i, n) ? Math.floor(Number(i)) : 0);
      stop();
      sync();
    }

    function step(dir) {
      show(stepIndex(index, n, dir));
      stop();
      sync();
    }

    if (n > 1) {
      var bar = doc.createElement('div');
      bar.className = 'sbc-bar';
      var prev = button(doc, 'sbc-btn', 'Previous picture', ICON_PREV);
      var next = button(doc, 'sbc-btn', 'Next picture', ICON_NEXT);
      var dotWrap = doc.createElement('div');
      dotWrap.className = 'sbc-dots';
      for (var k = 0; k < n; k++) {
        (function(i) {
          var d = button(doc, 'sbc-dot', 'Show picture ' + (i + 1) + ' of ' + n);
          d.addEventListener('click', function() { go(i); });
          dots.push(d);
          dotWrap.appendChild(d);
        })(k);
      }
      pauseBtn = button(doc, 'sbc-btn', userPaused ? 'Play slideshow' : 'Pause slideshow', userPaused ? ICON_PLAY : ICON_PAUSE);
      prev.addEventListener('click', function() { step(-1); });
      next.addEventListener('click', function() { step(1); });
      pauseBtn.addEventListener('click', function() {
        userPaused = !userPaused;
        pauseBtn.setAttribute('aria-label', userPaused ? 'Play slideshow' : 'Pause slideshow');
        pauseBtn.innerHTML = userPaused ? ICON_PLAY : ICON_PAUSE;
        sync();
      });
      bar.appendChild(prev);
      bar.appendChild(dotWrap);
      bar.appendChild(next);
      bar.appendChild(pauseBtn);
      // Using the controls holds the advance, with the mouse or the keyboard.
      bar.addEventListener('mouseenter', function() { hold = true; sync(); });
      bar.addEventListener('mouseleave', function() { hold = false; sync(); });
      bar.addEventListener('focusin', function() { hold = true; sync(); });
      bar.addEventListener('focusout', function() { hold = false; sync(); });
      el.appendChild(bar);
    }

    // Left and Right step through the pictures. Returns whether the key was one
    // of them, so a page that guards its keys (the break screen) can pass it on.
    function handleKey(e) {
      if (n < 2 || !e || e.type !== 'keydown') return false;
      if (e.key === 'ArrowLeft') { step(-1); return true; }
      if (e.key === 'ArrowRight') { step(1); return true; }
      return false;
    }

    el.addEventListener('keydown', function(e) {
      if (handleKey(e)) e.preventDefault();
    });

    show(index);
    sync();

    return {
      el: el,
      count: n,
      index: function() { return index; },
      go: go,
      step: step,
      handleKey: handleKey,
      destroy: function() {
        stop();
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  var API = {
    AUTOPLAY_MS: AUTOPLAY_MS,
    inRange: inRange,
    stepIndex: stepIndex,
    slideLabel: slideLabel,
    create: create
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBFocusCarousel = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));

// focus-break.js: the Pomodoro timer's break screen, on every web page.
//
// While a break runs (shared/focus-timer.js decides when), the page is covered
// by a calm screen with the time left and one idea for the break. It is a modal
// <dialog>, so the page underneath takes no clicks, no keys and no focus, and it
// sits above everything else on the page, a full-screen video included. It
// lifts by itself when the break ends. "Skip this break" ends it early and is
// counted in the popup's Pomodoro timer pane, so nobody is ever trapped.
//
// On the person's detox day, the pictures they love (their family, a sunset,
// their dog) fill the screen behind the card: a call to spend the day offline.
// One picture stays still; several play as a carousel (shared/focus-carousel.js).
// A site whose security rules refuse pictures shows the dark screen.
//
// It reads chrome.storage.local and asks the background for every change; the
// background is the only writer. Chrome's own pages, the Web Store and other
// programs are out of reach of any extension, so they stay usable.
(function() {
  'use strict';

  var F = window.SBFocus;
  if (!F || typeof chrome === 'undefined' || !chrome.storage || !chrome.runtime) return;

  var CSS =
    ':host{all:initial}' +
    'dialog{position:fixed;inset:0;box-sizing:border-box;width:100%;height:100%;max-width:none;max-height:none;margin:0;' +
      'padding:var(--sb-s-4);border:0;background:var(--sb-scrim-strong);display:flex;align-items:center;justify-content:center;' +
      'font-family:var(--sb-font);color-scheme:light;-webkit-font-smoothing:antialiased;overscroll-behavior:contain}' +
    'dialog:not([open]){display:none}' +
    'dialog::backdrop{background:transparent}' +
    '.gallery{position:absolute;inset:0}' +
    'dialog.has-controls{padding-bottom:72px}' +
    '.card{position:relative;box-sizing:border-box;width:min(420px,100%);max-height:100%;overflow:auto;padding:var(--sb-s-6);background:var(--sb-bg);' +
      'border-radius:var(--sb-r-2xl);box-shadow:var(--sb-shadow-xl);color:var(--sb-ink);text-align:left;line-height:1.5;outline:none;' +
      'animation:sbfIn var(--sb-dur-slow) var(--sb-ease) both}' +
    '.eyebrow{font-size:var(--sb-fs-12);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--sb-azure)}' +
    '.clock{margin:var(--sb-s-1) 0 var(--sb-s-4);font-size:var(--sb-fs-32);font-weight:700;letter-spacing:-.5px;line-height:1.2;font-variant-numeric:tabular-nums}' +
    '.warn{margin:0 0 var(--sb-s-4);padding:var(--sb-s-2) var(--sb-s-3);border-radius:var(--sb-r-md);background:var(--sb-warn-bg);' +
      'border:1px solid var(--sb-warn-bdr);font-size:var(--sb-fs-13)}' +
    '.warn[hidden]{display:none}' +
    'p{margin:0}' +
    '.lead{font-size:var(--sb-fs-13);color:var(--sb-ink-muted)}' +
    '.idea{margin:var(--sb-s-1) 0 var(--sb-s-3);font-size:var(--sb-fs-16);font-weight:600;line-height:1.4}' +
    '.rule{font-size:var(--sb-fs-13);color:var(--sb-ink-muted)}' +
    '.foot{display:flex;justify-content:flex-end;margin-top:var(--sb-s-5)}' +
    '.skip{height:32px;padding:0 var(--sb-s-2);margin-right:calc(-1 * var(--sb-s-2));font-family:inherit;font-size:var(--sb-fs-13);font-weight:600;' +
      'color:var(--sb-azure);background:none;border:0;border-radius:var(--sb-r-sm);cursor:pointer}' +
    '.skip:hover{text-decoration:underline}' +
    '.skip:focus-visible{outline:2px solid var(--sb-azure);outline-offset:2px}' +
    '@keyframes sbfIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.card{animation:none}}';

  var KEY_EVENTS = ['keydown', 'keypress', 'keyup'];

  var host = null;
  var dialog = null;
  var els = null;
  var timer = null;
  var lastFocus = null;
  var gallery = null;     // the detox day carousel, while it is on screen
  var current = null;     // the stored timer state, as last read
  var tickAskedFor = 0;   // the phase end already reported to the background

  function alive() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
  }

  function send(action) {
    // Once the extension is reloaded or removed, this page can no longer reach
    // it, and a screen nothing can lift must not stay up.
    if (!alive()) { hide(); return; }
    chrome.runtime.sendMessage({ type: 'sb_focus', action: action }, function() {
      var err = chrome.runtime.lastError;
      if (err) console.error('[Fibonax] The Pomodoro timer did not answer:', err.message);
    });
  }

  // Keys pressed while the screen is up never reach the page. Our own button
  // keeps its Enter and Space, but the page's shortcuts do not hear them, and
  // Escape does not close the screen: the break ends by time or by Skip.
  function guardKeys(e) {
    if (!host) return;
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(host) >= 0) {
      if (e.key === 'Escape') e.preventDefault();
      // The carousel's own key handler never hears this event, so Left and Right
      // are passed to it here.
      if (gallery && gallery.handleKey(e)) e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function stopScroll(e) {
    e.preventDefault();
  }

  function build() {
    host = document.createElement('div');
    host.setAttribute('data-sb-focus', '1');
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' + CSS + '</style>' +
      '<dialog aria-labelledby="sbf-title" aria-describedby="sbf-lead">' +
        '<div class="gallery"></div>' +
        '<div class="card" tabindex="-1" autofocus>' +
          '<div class="eyebrow" id="sbf-title"></div>' +
          '<div class="clock" role="timer" aria-label="Time left in the break"></div>' +
          '<div class="warn" role="status" hidden></div>' +
          '<p class="lead" id="sbf-lead"></p>' +
          '<p class="idea"></p>' +
          '<p class="rule"></p>' +
          '<div class="foot"><button type="button" class="skip">Skip this break</button></div>' +
        '</div>' +
      '</dialog>';
    dialog = shadow.querySelector('dialog');
    els = {
      gallery: shadow.querySelector('.gallery'),
      title: shadow.querySelector('.eyebrow'),
      clock: shadow.querySelector('.clock'),
      warn: shadow.querySelector('.warn'),
      idea: shadow.querySelector('.idea'),
      skip: shadow.querySelector('.skip')
    };
    shadow.querySelector('.lead').textContent = F.BREAK_LEAD;
    shadow.querySelector('.rule').textContent = F.PHONE_RULE;

    els.skip.addEventListener('click', function() { send({ type: 'skip' }); });
    dialog.addEventListener('cancel', function(e) { e.preventDefault(); });
    dialog.addEventListener('wheel', stopScroll, { passive: false });
    dialog.addEventListener('touchmove', stopScroll, { passive: false });

    document.documentElement.appendChild(host);
    if (F.isDetoxDay(current, Date.now())) showPhotos();
  }

  // Read only on the detox day: the pictures are the largest values the timer
  // keeps, and no other break needs them.
  function showPhotos() {
    chrome.storage.local.get(F.PHOTO_KEY, function(d) {
      if (chrome.runtime.lastError) {
        console.error('[Fibonax] Could not read the detox day pictures:', chrome.runtime.lastError.message);
        return;
      }
      var urls = F.photoUrls(d && d[F.PHOTO_KEY]);
      if (!urls.length || !els) return;
      var shown = dialog;
      gallery = SBFocusCarousel.create(urls, {
        onFail: function() { shown.classList.remove('has-controls'); }
      });
      els.gallery.appendChild(gallery.el);
      // Room under the card for the carousel's controls.
      if (gallery.count > 1) dialog.classList.add('has-controls');
    });
  }

  function openModal() {
    try {
      dialog.showModal();
    } catch (e) {
      console.error('[Fibonax] Could not show the break screen:', e);
    }
  }

  function paint(v) {
    els.title.textContent = v.title;
    els.clock.textContent = v.clock;
    els.idea.textContent = v.suggestion || '';
    var warn = v.warnings.join(' ');
    if (els.warn.textContent !== warn) els.warn.textContent = warn;
    els.warn.hidden = !warn;
  }

  function show(v) {
    if (!host) {
      lastFocus = document.activeElement;
      build();
      KEY_EVENTS.forEach(function(type) { window.addEventListener(type, guardKeys, true); });
      openModal();
    }
    paint(v);
    if (!timer) timer = setInterval(onSecond, 1000);
  }

  function hide() {
    if (timer) { clearInterval(timer); timer = null; }
    if (!host) return;
    KEY_EVENTS.forEach(function(type) { window.removeEventListener(type, guardKeys, true); });
    // Stops the carousel's timer: a removed screen must not keep one running.
    if (gallery) { gallery.destroy(); gallery = null; }
    var d = dialog;
    var h = host;
    host = null;
    dialog = null;
    els = null;
    d.close();
    h.remove();
    if (lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') {
      lastFocus.focus({ preventScroll: true });
    }
    lastFocus = null;
  }

  // The screen lifts at the end of the break even if the background has not
  // answered yet, and the background is asked to move the timer on.
  function onSecond() {
    var v = F.view(current, Date.now());
    if (!v.onBreak) { hide(); return; }
    if (v.leftMs <= 0) {
      var endsAt = current && current.run ? current.run.endsAt : 0;
      if (endsAt && tickAskedFor !== endsAt) {
        tickAskedFor = endsAt;
        send({ type: 'tick' });
      }
      hide();
      return;
    }
    if (!host) return;
    // Anything that closed the dialog (a page script, a browser shortcut) is
    // undone within a second while the break still runs.
    if (!dialog.open) openModal();
    paint(v);
  }

  function render(state) {
    current = state;
    var v = F.view(state, Date.now());
    if (v.onBreak && v.leftMs > 0) show(v);
    else hide();
  }

  chrome.storage.local.get(F.STORAGE_KEY, function(d) {
    if (chrome.runtime.lastError) {
      console.error('[Fibonax] Could not read the Pomodoro timer:', chrome.runtime.lastError.message);
      return;
    }
    render(d && d[F.STORAGE_KEY]);
  });

  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local' || !changes[F.STORAGE_KEY]) return;
    render(changes[F.STORAGE_KEY].newValue);
  });

  // A tab coming back into view shows the right time at once, not on the next
  // throttled timer.
  document.addEventListener('visibilitychange', function() {
    if (host && document.visibilityState === 'visible') onSecond();
  });
})();

// DOM presentation shared by the overlay, popup and mobile fill forms.
// Existing controls keep their handlers, values, order and keyboard semantics.
(function(root) {
  'use strict';
  function enhance(host, vm, cfg) {
    if (!host || host._fillUI) return;
    host.classList.add('ff-form');
    var rows = Array.prototype.slice.call(host.querySelectorAll(cfg.row));
    rows.forEach(function(row, index) {
      var field = vm.fields[index];
      if (!field) return;
      row.classList.add('ff-field');
      row.dataset.ffKey = field.key;
      var title = root.SBFillForm.fieldTitle(field);
      row.querySelectorAll(cfg.caption).forEach(function(el) { el.remove(); });
      var label = document.createElement('div');
      label.className = 'ff-label';
      label.textContent = title;
      row.prepend(label);
      row.querySelectorAll(cfg.control).forEach(function(el) {
        if (el.type !== 'radio' && el.type !== 'checkbox') el.setAttribute('aria-label', title);
      });
      var menu = row.querySelector(cfg.menu);
      if (menu) {
        var dropdown = document.createElement('details');
        dropdown.className = 'ff-menu';
        var summary = document.createElement('summary');
        summary.setAttribute('aria-label', title + ' — choices');
        dropdown.appendChild(summary);
        menu.replaceWith(dropdown);
        dropdown.appendChild(menu);
        dropdown.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' && dropdown.open) {
            e.stopPropagation(); dropdown.open = false; summary.focus();
          }
        });
        dropdown.addEventListener('change', function(e) {
          if (e.target.type === 'radio' && !e.target.hasAttribute('data-other')) {
            dropdown.open = false; summary.focus();
          }
        });
      }
      var error = document.createElement('p');
      error.className = 'ff-error';
      error.setAttribute('role', 'alert');
      error.id = 'ff-error-' + cfg.prefix + '-' + index;
      error.hidden = true;
      row.appendChild(error);
      row.querySelectorAll(cfg.control).forEach(function(el) { el.setAttribute('aria-describedby', error.id); });
    });
    if (vm.sections.length > 1) {
      vm.sections.forEach(function(section) {
        var group = document.createElement('details'); group.className = 'ff-section'; group.open = true;
        var summary = document.createElement('summary'); summary.textContent = section.title;
        group.appendChild(summary);
        var grid = document.createElement('div'); grid.className = 'ff-grid'; group.appendChild(grid);
        var members = rows.filter(function(row) { return section.keys.indexOf(row.dataset.ffKey) !== -1; });
        if (members.length) members[0].before(group);
        members.forEach(function(row) { grid.appendChild(row); });
      });
    }
    host._fillUI = { rows: rows, cfg: cfg, attempted: false };
    refresh(host, vm);
  }
  function refresh(host, vm) {
    if (!host || !host._fillUI) return;
    var state = host._fillUI;
    state.rows.forEach(function(row) {
      var field = vm.fields.find(function(f) { return f.key === row.dataset.ffKey; });
      if (!field) return;
      var summary = row.querySelector('.ff-menu > summary');
      if (summary) summary.textContent = field.value || (field.otherOn ? field.other : 'Choose an option');
      row.querySelector('.ff-label').textContent = root.SBFillForm.fieldTitle(field) + (field.required ? ' *' : '');
      var message = state.attempted ? field.error : '';
      var error = row.querySelector('.ff-error'); error.hidden = !message; error.textContent = message;
      // A box flagged by Fix it stops being flagged the moment it is changed.
      var warn = row.querySelector('.ff-warn');
      if (warn && row._ffWarnedValue !== field.value) { warn.remove(); delete row._ffWarnedValue; }
      row.querySelectorAll(state.cfg.control).forEach(function(el) {
        el.setAttribute('aria-invalid', message ? 'true' : 'false');
      });
    });
  }
  function validate(host, vm) {
    if (!host || !host._fillUI) return vm.errors.length === 0;
    host._fillUI.attempted = true; refresh(host, vm);
    if (!vm.errors.length) return true;
    var row = host._fillUI.rows.find(function(r) { return r.dataset.ffKey === vm.errors[0].key; });
    if (row) {
      var parent = row.parentElement;
      while (parent && parent !== host) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
      var menu = row.querySelector('.ff-menu'); if (menu) menu.open = true;
      var control = row.querySelector(host._fillUI.cfg.control);
      if (control) control.focus();
      row.scrollIntoView({block:'nearest'});
    }
    return false;
  }
  // ── BEFORE IT GOES OUT ──────────────────────────────────────────
  // What every surface shows when SBFillForm.unfinished() finds something in
  // the text about to be inserted or copied. One window, built here, so the
  // page, the popup and the phone say the same words in the same order and
  // answer the same keys. The words come from SBFillForm.unfinishedText.

  function words(key, slots) { return root.SBFillForm.unfinishedText(key, slots); }

  function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

  // The line under one piece: why it was flagged and, for a piece that sits in
  // a box, which box to look in.
  function why(item, fields) {
    if (item.kind === 'empty' || !item.key) return item.reason;
    var field = (fields || []).find(function(f) { return f.key === item.key; });
    return field ? item.reason + ' · ' + words('in-field', { title: root.SBFillForm.fieldTitle(field) }) : item.reason;
  }

  var openDialog = null;

  /**
   * Opens the warning. Only one is ever open: a second call replaces the first.
   *
   * @param {Object} opts
   * @param {Array}  opts.items    what SBFillForm.unfinished() found
   * @param {Array}  [opts.fields] the form's fields, to name the box a piece is in
   * @param {string} opts.primary  'fix' (back to the form), 'edit' (open the
   *   editor), or '' where neither can help: the phone, which edits nothing
   * @param {string} opts.anyway   'insert-anyway', 'copy-anyway' or 'share-anyway'
   * @param {boolean} [opts.mute]  offer "Don't warn me about this snippet again"
   * @param {Function} opts.onPrimary
   * @param {Function} opts.onAnyway  (muted, done): muted is true when the mute
   *   box is ticked; the window then stays open until done() is called
   * @param {Function} opts.onClose   Esc, the close button or the backdrop
   * @returns {{ close: Function, busy: Function }} close removes it with no answer;
   *   busy(true) holds the buttons while the caller saves the mute choice
   */
  function unfinishedDialog(opts) {
    if (openDialog) openDialog.close();
    var doc = root.document;
    var items = opts.items || [];
    var shown = items.slice(0, root.SBFillForm.UNFINISHED_SHOWN);
    var returnFocus = doc.activeElement;

    var bd = doc.createElement('div');
    bd.id = 'ff-unf-bd';
    var box = doc.createElement('div');
    box.id = 'ff-unf';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'ff-unf-title');
    box.setAttribute('aria-describedby', 'ff-unf-intro');

    var head = doc.createElement('div');
    head.className = 'ff-unf-head';
    var icon = doc.createElement('span');
    icon.className = 'ff-unf-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
    var title = doc.createElement('h2');
    title.id = 'ff-unf-title';
    title.textContent = words('title');
    var closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ff-unf-close';
    closeBtn.setAttribute('aria-label', 'Cancel');
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    head.appendChild(icon); head.appendChild(title); head.appendChild(closeBtn);

    var body = doc.createElement('div');
    body.className = 'ff-unf-body';
    var intro = doc.createElement('p');
    intro.id = 'ff-unf-intro';
    intro.textContent = words('intro');
    body.appendChild(intro);
    var list = doc.createElement('ul');
    list.className = 'ff-unf-list';
    shown.forEach(function(item) {
      var li = doc.createElement('li');
      var piece = doc.createElement('span');
      piece.className = 'ff-unf-piece' + (item.kind === 'empty' ? ' ff-unf-box' : '');
      piece.textContent = item.text;
      var line = doc.createElement('span');
      line.className = 'ff-unf-why';
      line.textContent = why(item, opts.fields);
      li.appendChild(piece); li.appendChild(line);
      list.appendChild(li);
    });
    body.appendChild(list);
    if (items.length > shown.length) {
      var more = doc.createElement('p');
      more.className = 'ff-unf-more';
      more.textContent = words('more', { n: items.length - shown.length });
      body.appendChild(more);
    }
    var muteBox = null;
    if (opts.mute) {
      var mute = doc.createElement('label');
      mute.className = 'ff-unf-mute';
      muteBox = doc.createElement('input');
      muteBox.type = 'checkbox';
      var muteText = doc.createElement('span');
      muteText.textContent = words('mute');
      mute.appendChild(muteBox); mute.appendChild(muteText);
      body.appendChild(mute);
    }

    var foot = doc.createElement('div');
    foot.className = 'ff-unf-foot';
    var anyway = doc.createElement('button');
    anyway.type = 'button';
    anyway.className = 'ff-unf-secondary';
    anyway.textContent = words(opts.anyway);
    var primary = null;
    foot.appendChild(anyway);
    if (opts.primary) {
      primary = doc.createElement('button');
      primary.type = 'button';
      primary.className = 'ff-unf-primary';
      primary.textContent = words(opts.primary);
      foot.appendChild(primary);
    }

    box.appendChild(head); box.appendChild(body); box.appendChild(foot);
    doc.body.appendChild(bd);
    doc.body.appendChild(box);

    var settled = false;
    function remove() {
      if (settled) return false;
      settled = true;
      doc.removeEventListener('keydown', onKey, true);
      box.remove(); bd.remove();
      if (openDialog === handle) openDialog = null;
      return true;
    }
    function cancel() {
      if (!remove()) return;
      if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
        try { returnFocus.focus({ preventScroll: true }); } catch (e) { returnFocus.focus(); }
      }
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    function onKey(e) {
      if (settled) return;
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); cancel();
        return;
      }
      if (!box.contains(doc.activeElement)) return;
      // The page under the window must not act on a key meant for it: Enter in
      // a mail editor sends, a letter can be a shortcut.
      e.stopPropagation();
      if (e.key === 'Tab') {
        var stops = [closeBtn, muteBox, anyway, primary].filter(function(n) { return n && !n.disabled; });
        var at = stops.indexOf(doc.activeElement);
        var next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at === stops.length - 1 ? 0 : at + 1);
        e.preventDefault();
        stops[next].focus();
      }
    }

    closeBtn.addEventListener('click', cancel);
    bd.addEventListener('click', cancel);
    if (primary) primary.addEventListener('click', function() { if (remove()) opts.onPrimary(); });
    anyway.addEventListener('click', function() {
      var muted = !!(muteBox && muteBox.checked);
      // Ticked, the window stays open, held, while the caller saves the choice,
      // and closes when the caller says so. Otherwise it closes first.
      if (muted) handle.busy(true);
      else if (!remove()) return;
      opts.onAnyway(muted, remove);
    });
    doc.addEventListener('keydown', onKey, true);
    // The safe choice holds the focus, so a stray Enter fixes, or closes,
    // rather than sends.
    (primary || closeBtn).focus();

    var handle = {
      close: remove,
      busy: function(on) {
        [closeBtn, muteBox, anyway, primary].forEach(function(n) { if (n) n.disabled = !!on; });
        box.setAttribute('aria-busy', on ? 'true' : 'false');
      }
    };
    openDialog = handle;
    return handle;
  }

  /**
   * Fix it: marks each box the warning named with what was wrong in it, and
   * puts the caret in the first. Marks the snippet's own text cannot carry
   * stay in the window's list; nothing here rewrites what the person typed.
   * Returns whether any box was marked.
   */
  function flag(host, vm, items) {
    if (!host || !host._fillUI) return false;
    var doc = root.document;
    var byKey = {};
    (items || []).forEach(function(it) { if (it.key) (byKey[it.key] = byKey[it.key] || []).push(it); });
    var first = null;
    host._fillUI.rows.forEach(function(row, index) {
      var key = row.dataset.ffKey;
      var note = row.querySelector('.ff-warn');
      var mine = byKey[key];
      if (!mine) { if (note) note.remove(); delete row._ffWarnedValue; return; }
      if (!note) {
        note = doc.createElement('p');
        note.className = 'ff-warn';
        note.id = 'ff-warn-' + host._fillUI.cfg.prefix + '-' + index;
        var error = row.querySelector('.ff-error');
        row.insertBefore(note, error || null);
        row.querySelectorAll(host._fillUI.cfg.control).forEach(function(el) {
          var ids = (el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
          if (ids.indexOf(note.id) === -1) ids.push(note.id);
          el.setAttribute('aria-describedby', ids.join(' '));
        });
      }
      note.textContent = mine.map(function(it) {
        return it.kind === 'empty' ? it.reason : '“' + it.text + '”: ' + lowerFirst(it.reason);
      }).join(' · ');
      var field = vm.fields.find(function(f) { return f.key === key; });
      row._ffWarnedValue = field ? field.value : '';
      if (!first) first = row;
    });
    if (!first) return false;
    var parent = first.parentElement;
    while (parent && parent !== host) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
    var control = first.querySelector('.ff-menu > summary') || first.querySelector(host._fillUI.cfg.control);
    if (control) control.focus();
    first.scrollIntoView({ block: 'nearest' });
    return true;
  }

  // ── PREVIEW ─────────────────────────────────────────────────────
  // The finished message in a preview box: the text, and each picture in its
  // place. Built from nodes, never from markup: the text comes from people and
  // web pages. A picture the page will not load (some sites refuse outside
  // pictures) shows as a labelled box. Pictures already drawn are kept, so
  // typing in the form does not make them blink.
  // An email layout is drawn in a frame of its own instead, as the dashboard
  // draws it (LayoutFrame.tsx): the card with its tables, colours and spacing,
  // in a document that runs nothing and reads nothing of the page
  // (layoutDocument in fill-form.js). The frame stays across redraws and only
  // its body is rewritten, so typing in the form does not reload it. A page
  // whose policy refuses the frame gets the card as lines and cells instead.
  function showPreview(box, vm) {
    if (!box) return;
    var M = root.SBFillForm;
    var layout = vm.formatted && !vm.parts ? String(vm.formatted) : '';
    var framed = !!layout && !box._ffNoFrame && M.isEmailLayout(layout) && layoutFrame(box, layout);
    box.classList.toggle('ff-framed', framed);
    if (framed) { box.classList.remove('ff-layout'); return; }
    var lines = layout ? M.layoutFragment(layout) : null;
    box.classList.toggle('ff-layout', !!lines);
    if (lines) { box.textContent = ''; box.appendChild(lines); return; }
    if (!vm.parts) { box.textContent = vm.preview; return; }
    var drawn = {};
    Array.prototype.forEach.call(box.querySelectorAll('[data-ff-pic]'), function(n) {
      (drawn[n.dataset.ffPic] = drawn[n.dataset.ffPic] || []).push(n);
    });
    box.textContent = '';
    vm.parts.forEach(function(part) {
      if (!part.picture) { box.appendChild(document.createTextNode(part.text)); return; }
      var pic = part.picture, key = pic.size + ' ' + pic.src + ' ' + pic.alt;
      var again = drawn[key] && drawn[key].shift();
      if (again) { box.appendChild(again); return; }
      var img = document.createElement('img');
      img.className = 'ff-pic ff-pic--' + pic.size;
      img.alt = pic.alt;
      img.dataset.ffPic = key;
      img.addEventListener('error', function() {
        var label = document.createElement('span');
        label.className = 'ff-pic-missing';
        label.dataset.ffPic = key;
        label.textContent = root.SBFillForm.pictureText('missing') + (pic.alt ? ': ' + pic.alt : '');
        if (img.parentNode) img.parentNode.replaceChild(label, img);
      });
      img.src = pic.src;
      box.appendChild(img);
    });
  }

  // Draws an email layout in the box's frame, making the frame on the first
  // call. False once the page has refused the frame.
  function layoutFrame(box, html) {
    var M = root.SBFillForm;
    var frame = box.querySelector('iframe.ff-frame');
    if (frame && frame._ffHtml === html) return true;
    if (frame && frame._ffReady) {
      frame._ffHtml = html;
      frame.contentDocument.body.innerHTML = html;
      sizeFrame(frame);
      return true;
    }
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'ff-frame';
      frame.title = 'Layout';
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.addEventListener('load', function() {
        var inner = frame.contentDocument;
        // The frame's first, blank document loads before the layout does.
        if (inner && inner.URL !== 'about:srcdoc') return;
        if (!inner || !inner.body) {
          // The page's policy refused the frame: the card as lines and cells.
          box._ffNoFrame = true;
          box.classList.remove('ff-framed');
          box.classList.add('ff-layout');
          box.textContent = '';
          box.appendChild(M.layoutFragment(frame._ffHtml));
          return;
        }
        frame._ffReady = true;
        sizeFrame(frame);
      });
      // A card wraps differently at every width, and a pane hidden behind a
      // switch (the overlay's Preview on a narrow window) measures nothing
      // until it shows: the height is read again whenever the frame's own
      // size changes.
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(function() { sizeFrame(frame); }).observe(frame);
      }
      box.textContent = '';
      box.appendChild(frame);
    }
    // Asked again before the first document has loaded: the newest layout wins.
    frame._ffHtml = html;
    frame.srcdoc = M.layoutDocument(html);
    readyFrame(frame, 40);
    return true;
  }

  // The frame's load waits for the card's pictures, so the height is read as
  // soon as the layout's document has its body, and the frame takes redraws
  // from then on.
  function readyFrame(frame, tries) {
    var inner = frame.contentDocument;
    if (inner && inner.URL === 'about:srcdoc' && inner.body && inner.readyState !== 'loading') {
      frame._ffReady = true;
      sizeFrame(frame);
      return;
    }
    if (tries > 0) setTimeout(function() { readyFrame(frame, tries - 1); }, 50);
  }

  // The frame as tall as the card, and again as each of its pictures arrives.
  // The box around it scrolls; the frame never does. A frame that is not laid
  // out yet (a hidden pane) measures nothing and keeps its height for now.
  function sizeFrame(frame) {
    var inner = frame.contentDocument;
    if (!inner || !inner.body) return;
    var height = inner.body.offsetHeight;
    if (!height) return;
    frame.style.height = Math.min(Math.max(height, 40), 2400) + 'px';
    Array.prototype.forEach.call(inner.images, function(img) {
      if (img._ffSized) return;
      img._ffSized = true;
      img.addEventListener('load', function() { sizeFrame(frame); });
    });
  }

  // The line that says where the pictures go ('left-out', 'copy', 'share').
  // Hidden while the text has none.
  function pictureNote(el, vm, key) {
    if (!el) return;
    var n = root.SBFillForm.pictureCount(vm);
    el.hidden = n === 0;
    el.textContent = n ? root.SBFillForm.pictureText(key, n) : '';
  }

  root.SBFillFormUI = { enhance: enhance, refresh: refresh, validate: validate,
    unfinishedDialog: unfinishedDialog, flag: flag, showPreview: showPreview, pictureNote: pictureNote };
})(typeof window !== 'undefined' ? window : this);

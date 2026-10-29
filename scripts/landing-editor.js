/* Click-to-edit and drag-to-reorder for the English landing page. Served only by
   scripts/serve-landing.js when the address ends in ?edit. Never part of the published page. */
(function () {
  var rev = document.currentScript.getAttribute('data-rev');
  var current = null;
  var before = '';
  var hovered = null;
  var block = null;
  var pinned = false;
  var dragging = null;
  var drop = null;
  var busy = false;

  var saved = 0;
  try { saved = Number(sessionStorage.getItem('ed-saved')) || 0; } catch (e) { saved = 0; }
  try {
    var y = Number(sessionStorage.getItem('ed-scroll'));
    sessionStorage.removeItem('ed-scroll');
    if (y) window.scrollTo(0, y);
  } catch (e) { y = 0; }

  function ui(tag, css, text) {
    var el = document.createElement(tag);
    el.setAttribute('data-ed-ui', '');
    el.setAttribute('style', css);
    if (text) el.textContent = text;
    document.body.appendChild(el);
    return el;
  }

  var BTN = 'all:unset;cursor:pointer;padding:6px 12px;border-radius:999px;font:600 12px/1 system-ui,sans-serif;';
  var bar = ui('div', 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;' +
    'background:#1d1d1f;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:999px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:92vw;text-align:center;display:flex;gap:10px;align-items:center');
  var outline = ui('div', 'position:fixed;z-index:2147483646;pointer-events:none;display:none;' +
    'outline:2px solid #7c3aed;outline-offset:2px;border-radius:4px');
  var tools = ui('div', 'position:fixed;z-index:2147483647;display:none;gap:4px;background:#7c3aed;padding:4px;' +
    'border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.25)');
  var line = ui('div', 'position:fixed;z-index:2147483647;pointer-events:none;display:none;background:#7c3aed;border-radius:2px');

  function tool(label, title) {
    var b = document.createElement('button');
    b.setAttribute('data-ed-ui', '');
    b.setAttribute('style', BTN + 'background:#fff;color:#5b21b6');
    b.textContent = label;
    b.title = title;
    tools.appendChild(b);
    return b;
  }
  var moveBtn = tool('Move', 'Hold and drag to a new place');
  var upBtn = tool('Up a level', 'Select the block around this one');
  var delBtn = tool('Delete', 'Remove this block');
  tools.style.display = 'none';

  function say(text, buttons) {
    bar.textContent = text;
    (buttons || []).forEach(function (b) {
      var el = document.createElement('button');
      el.setAttribute('data-ed-ui', '');
      el.setAttribute('style', BTN + (b.primary ? 'background:#fff;color:#1d1d1f' : 'background:#3a3a3c;color:#fff'));
      el.textContent = b.label;
      el.addEventListener('click', b.run);
      bar.appendChild(el);
    });
  }
  function idle() {
    say('Edit mode: click text to change it. Hover a block to move or delete it.' + (saved ? ' Saved ' + saved + '.' : ''));
  }
  idle();

  var style = document.createElement('style');
  style.textContent = '[data-ed-hover]{outline:2px dashed #1b4fd8;outline-offset:3px;cursor:text}' +
    '[data-ed-active]{outline:2px solid #1b4fd8;outline-offset:3px;cursor:text}';
  document.head.appendChild(style);

  function clean(html) { return html.replace(/\sdata-ed="\d+"/g, ''); }

  function send(payload, done) {
    busy = true;
    say('Saving…');
    payload.rev = rev;
    fetch('/__save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); }).then(function (r) {
      busy = false;
      if (!r.ok) { done(r.error); return; }
      try {
        sessionStorage.setItem('ed-saved', String(saved + 1));
        sessionStorage.setItem('ed-scroll', String(window.scrollY));
      } catch (e) { /* the counter is a convenience */ }
      window.location.reload();
    }).catch(function () {
      busy = false;
      done('the preview server did not answer.');
    });
  }

  /* Text */
  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    }
    return false;
  }
  function inUi(el) { return !!(el && el.closest && el.closest('[data-ed-ui]')); }
  function pick(target) {
    for (var el = target; el && el !== document.body; el = el.parentElement) {
      if (inUi(el)) return null;
      if (hasOwnText(el)) return el;
    }
    return null;
  }

  function finishText() {
    if (!current) return;
    var el = current;
    current = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-ed-active');
    var after = clean(el.innerHTML);
    if (after === before) { idle(); return; }
    send({ op: 'text', before: before, after: after }, function (error) {
      el.innerHTML = before;
      say('Not saved: ' + error);
    });
  }

  /* Blocks */
  function siblingsOf(el) {
    var p = el.parentElement;
    if (!p) return [];
    return Array.prototype.filter.call(p.children, function (c) {
      var r = c.getBoundingClientRect();
      return c !== el && c.hasAttribute('data-ed') && r.width > 0 && r.height > 0;
    });
  }
  function blockOf(start) {
    for (var el = start; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (inUi(el) || !el.hasAttribute('data-ed')) continue;
      var r = el.getBoundingClientRect();
      if (r.width >= 60 && r.height >= 40 && siblingsOf(el).length) return el;
    }
    return null;
  }

  function showBlock() {
    if (!block || current || dragging) { outline.style.display = tools.style.display = 'none'; return; }
    var r = block.getBoundingClientRect();
    outline.style.cssText += ';display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    tools.style.display = 'flex';
    tools.style.left = Math.max(4, r.left) + 'px';
    tools.style.top = Math.max(4, r.top - 40) + 'px';
  }
  function setBlock(el) {
    if (el === block) return;
    block = el;
    showBlock();
  }

  document.addEventListener('mouseover', function (e) {
    if (dragging || busy) return;
    if (inUi(e.target)) return;
    var el = pick(e.target);
    if (hovered && hovered !== el) hovered.removeAttribute('data-ed-hover');
    hovered = el;
    if (el && el !== current) el.setAttribute('data-ed-hover', '');
    if (current) return;
    if (pinned && block && block.contains(e.target)) return;
    pinned = false;
    setBlock(blockOf(e.target));
  });
  window.addEventListener('scroll', showBlock, true);
  window.addEventListener('resize', showBlock);

  upBtn.addEventListener('click', function () {
    if (!block) return;
    var up = blockOf(block.parentElement);
    if (up) { pinned = true; block = up; showBlock(); }
  });

  delBtn.addEventListener('click', function () {
    var target = block;
    if (!target) return;
    say('Delete this block?', [
      { label: 'Delete', primary: true, run: function () {
        send({ op: 'delete', id: target.getAttribute('data-ed') }, function (error) { say('Not deleted: ' + error); });
      } },
      { label: 'Cancel', run: idle },
    ]);
  });

  /* Drag */
  function nearest(x, y) {
    var best = null;
    var bestD = Infinity;
    siblingsOf(dragging).forEach(function (s) {
      var r = s.getBoundingClientRect();
      var dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      var dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = s; }
    });
    return best;
  }
  function aim(x, y) {
    var target = nearest(x, y);
    if (!target) { drop = null; line.style.display = 'none'; return; }
    var r = target.getBoundingClientRect();
    var m = dragging.getBoundingClientRect();
    var sideBySide = r.top < m.bottom && r.bottom > m.top && !(r.left < m.right && r.right > m.left && Math.abs(r.top - m.top) > 2);
    var after = sideBySide ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    drop = { target: target, where: after ? 'after' : 'before' };
    line.style.display = 'block';
    if (sideBySide) {
      line.style.cssText += ';left:' + ((after ? r.right : r.left) - 2) + 'px;top:' + r.top + 'px;width:4px;height:' + r.height + 'px';
    } else {
      line.style.cssText += ';left:' + r.left + 'px;top:' + ((after ? r.bottom : r.top) - 2) + 'px;width:' + r.width + 'px;height:4px';
    }
  }
  function onMove(e) { aim(e.clientX, e.clientY); }
  function endDrag() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    document.removeEventListener('keydown', onEsc, true);
    if (dragging) dragging.style.opacity = '';
    dragging = null;
    line.style.display = 'none';
    showBlock();
  }
  function onUp() {
    var moved = dragging;
    var where = drop;
    endDrag();
    if (!moved || !where) { idle(); return; }
    send({ op: 'move', id: moved.getAttribute('data-ed'), targetId: where.target.getAttribute('data-ed'), where: where.where },
      function (error) { say('Not moved: ' + error); });
  }
  function onEsc(e) {
    if (e.key !== 'Escape') return;
    drop = null;
    endDrag();
    idle();
  }
  moveBtn.addEventListener('mousedown', function (e) {
    if (!block || e.button !== 0) return;
    e.preventDefault();
    dragging = block;
    drop = null;
    dragging.style.opacity = '.35';
    outline.style.display = tools.style.display = 'none';
    say('Drag to a new place and let go. Esc cancels.');
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('keydown', onEsc, true);
  });

  /* Text clicks and keys */
  document.addEventListener('click', function (e) {
    if (inUi(e.target) || dragging || busy) return;
    var el = pick(e.target);
    if (el && el === current) return;
    e.preventDefault();
    e.stopPropagation();
    finishText();
    if (!el) return;
    current = el;
    before = clean(el.innerHTML);
    el.removeAttribute('data-ed-hover');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-ed-active', '');
    showBlock();
    el.focus();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!current) return;
    if (e.key === 'Escape') {
      current.innerHTML = before;
      finishText();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      finishText();
    }
  }, true);
})();

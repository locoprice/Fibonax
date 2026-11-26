// THE SEARCH WINDOW: "Search or ask", one window for every surface.
//
// Clicking a search bar (or Ctrl+K / Cmd+K) opens this window over the page.
// The popup and the dashboard load this file; the phone carries an inlined
// copy (scripts/sync-command-palette.js). Each surface hands it its library
// and says what "open" means there; everything a person sees and presses is
// decided here, so the three cannot drift.
//
// What it does:
//   Nothing typed   what was opened lately, under Today, Yesterday, Past week,
//                   Past 30 days and Older (shared/recents.js). An empty
//                   heading is left out.
//   Something typed results from the one search rule (shared/asset-search.js):
//                   every word, anywhere, any order, capitals and accents
//                   ignored. Names first, then what was found in the text,
//                   with the sentence it was found in.
//   Chips           Title only, Created by, In, and + Filter (Type, Labels,
//                   Date edited). A chip that is on is tinted and has a cross.
//   Keys            Up and Down move the highlight (the mouse moves the same
//                   one), Enter opens, Ctrl+Enter is the surface's second way
//                   to open, Esc clears the text first and closes second.
//   Ask             the sparkle button hands the question to the surface's
//                   own FiboChat, where there is one.
//
// An item, as a surface hands it over:
//   key       unique, also what the recents list keeps: 'snippet:<id>'
//   kind      'snippet' | 'prompt' | 'brain' | 'item' (an item inside a Brain)
//   title     its name
//   shortcut  its trigger or shortcut, '' when it has none
//   place     the folder or the Brain it sits in, '' when none
//   placeKey  what the In filter keeps for that place (a Brain names itself)
//   byName    who created it: 'You' or a teammate's name, '' when unknown
//   edited    when it was last changed, in milliseconds, 0 when unknown
//   labels    the names of its labels
//   keywords  its search keywords
//   text      its texts, one per language
(function (root) {
  'use strict';

  var DEBOUNCE_MS = 130;
  var DAY = 24 * 60 * 60 * 1000;
  var CLOSE_MS = 120;

  var SECTION = { snippet: 'Snippets', prompt: 'Prompts', brain: 'Brains', item: 'Brains' };
  var TYPES = [['snippet', 'Snippets'], ['prompt', 'Prompts'], ['brain', 'Brains']];
  var EDITED = [['today', 'Today'], ['week', 'Past week'], ['month', 'Past 30 days'], ['older', 'Older']];
  var MORE = [['type', 'Type'], ['labels', 'Labels'], ['edited', 'Date edited']];

  function rule() { return root.SBAssetSearch; }
  function recentsApi() { return root.SBRecents; }

  function svg(body, cls) {
    return '<svg class="sbcp-svg' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  var ICON = {
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 'sbcp-glass'),
    snippet: svg('<path d="M7 3H5a2 2 0 0 0-2 2v2m14-4h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6"/>'),
    prompt: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>'),
    brain: svg('<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>'),
    item: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    cross: svg('<path d="M18 6 6 18M6 6l12 12"/>', 'sbcp-svg-s'),
    down: svg('<path d="m6 9 6 6 6-6"/>', 'sbcp-svg-s'),
    plus: svg('<path d="M12 5v14M5 12h14"/>', 'sbcp-svg-s'),
    check: svg('<path d="m5 12 5 5 9-10"/>', 'sbcp-svg-s')
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function list(values) { return Array.isArray(values) ? values : []; }

  /** Where an item sits, as the grey text after its name. */
  function crumb(item) {
    var section = SECTION[item.kind] || '';
    return item.place ? section + ' / ' + item.place : section;
  }

  /** A Brain and the items inside one are both "Brains" to the Type filter. */
  function typeOf(item) { return item.kind === 'item' ? 'brain' : item.kind; }

  function emptyFilters() {
    return { titleOnly: false, by: [], places: [], more: [], types: [], labels: [], edited: null };
  }

  function filtersOn(f) {
    return !!(f.titleOnly || f.by.length || f.places.length || f.more.length);
  }

  function dayStart(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Whether something changed at `at` falls in one of the Date edited choices. */
  function editedIn(at, key, now) {
    if (!at) return false;
    var age = now - at;
    if (key === 'today') return dayStart(at) >= dayStart(now);
    if (key === 'week') return age <= 7 * DAY;
    if (key === 'month') return age <= 30 * DAY;
    return age > 30 * DAY;
  }

  /** Whether the chips let an item through. Title only is not decided here: it changes what is read. */
  function passes(item, f, now) {
    if (f.by.length && f.by.indexOf(item.byName || '') < 0) return false;
    if (f.places.length && f.places.indexOf(item.placeKey || '') < 0) return false;
    if (f.more.indexOf('type') > -1 && f.types.length && f.types.indexOf(typeOf(item)) < 0) return false;
    if (f.more.indexOf('labels') > -1 && f.labels.length) {
      var labels = list(item.labels), any = false;
      for (var i = 0; i < labels.length && !any; i++) any = f.labels.indexOf(labels[i]) > -1;
      if (!any) return false;
    }
    if (f.more.indexOf('edited') > -1 && f.edited && !editedIn(item.edited, f.edited, now)) return false;
    return true;
  }

  /**
   * What the chips can offer, read from the library itself: the people who
   * created something, the places things sit in, the labels in use, and
   * whether anything says when it was edited.
   */
  function facets(items) {
    var people = [], places = [], labels = [], seen = {}, edited = false;
    list(items).forEach(function (item) {
      var who = item.byName || '';
      if (who && !seen['p:' + who]) { seen['p:' + who] = true; people.push(who); }
      var key = item.placeKey || '';
      var name = item.kind === 'brain' ? item.title : item.place;
      if (key && name && !seen['l:' + key]) {
        seen['l:' + key] = true;
        places.push({ section: SECTION[item.kind] || '', key: key, name: name });
      }
      list(item.labels).forEach(function (label) {
        if (label && !seen['t:' + label]) { seen['t:' + label] = true; labels.push(label); }
      });
      if (item.edited) edited = true;
    });
    people.sort(function (a, b) { return a === 'You' ? -1 : b === 'You' ? 1 : a.localeCompare(b); });
    places.sort(function (a, b) { return a.name.localeCompare(b.name); });
    labels.sort(function (a, b) { return a.localeCompare(b); });
    return { people: people, places: places, labels: labels, edited: edited };
  }

  /**
   * The results for what was typed: [{ item, rank, why }], best first.
   *
   *   rank 2  the name or the shortcut holds every word
   *   rank 1  found through the text, a keyword, a label or the place
   *
   * Within a rank, a name that starts with the first word comes first, then
   * what was opened or edited most recently. `opened` maps a key to when it
   * was last opened.
   */
  function find(items, query, f, now, opened) {
    var S = rule(), words = S.words(query), rows = [];
    if (!words.length) return rows;
    var when = opened || {};
    list(items).forEach(function (item) {
      if (!passes(item, f, now)) return;
      var look = S.look(query, f.titleOnly
        ? { shown: [item.title, item.shortcut] }
        : {
            shown: [item.title, item.shortcut],
            keywords: item.keywords,
            labels: item.labels,
            also: [item.place, SECTION[item.kind]],
            text: item.text
          });
      if (!look) return;
      rows.push({
        item: item,
        rank: look.rank,
        why: look.why,
        starts: S.fold(item.title).indexOf(words[0]) === 0 ? 1 : 0,
        when: when[item.key] || item.edited || 0
      });
    });
    rows.sort(function (a, b) {
      return (b.rank - a.rank) || (b.starts - a.starts) || (b.when - a.when) ||
        String(a.item.title).localeCompare(String(b.item.title));
    });
    return rows;
  }

  /** What was opened lately and still exists, newest first: [{ item, at }]. */
  function recentRows(items, recent, f, now) {
    var byKey = {};
    list(items).forEach(function (item) { byKey[item.key] = item; });
    var rows = [];
    list(recent).forEach(function (row) {
      var item = byKey[row.k];
      if (item && passes(item, f, now)) rows.push({ item: item, at: row.t });
    });
    return rows;
  }

  /** A name with the typed words wrapped in <mark>, escaped. */
  function markTitle(title, words) {
    var text = String(title == null ? '' : title);
    var folded = rule().fold(text), hits = [];
    list(words).forEach(function (word) {
      if (!word) return;
      var at = folded.indexOf(word);
      while (at > -1) { hits.push([at, at + word.length]); at = folded.indexOf(word, at + 1); }
    });
    if (!hits.length) return esc(text);
    hits.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [hits[0]];
    for (var i = 1; i < hits.length; i++) {
      var last = merged[merged.length - 1];
      if (hits[i][0] <= last[1]) last[1] = Math.max(last[1], hits[i][1]);
      else merged.push(hits[i]);
    }
    var out = '', pos = 0;
    merged.forEach(function (m) {
      out += esc(text.slice(pos, m[0])) + '<mark>' + esc(text.slice(m[0], m[1])) + '</mark>';
      pos = m[1];
    });
    return out + esc(text.slice(pos));
  }

  function isMac() {
    var nav = root.navigator;
    return !!nav && /Mac|iPhone|iPad/.test(String(nav.platform || nav.userAgent || ''));
  }

  /**
   * Draws the window and returns its handle.
   *
   * cfg:
   *   host            where the window is added (the page's body by default)
   *   name            a prefix for the ids it writes ('sbcp' by default)
   *   items()         the library, as the items described at the top
   *   loading()       true while the very first copy of the library is on its way
   *   recents         a list from SBRecents.open(...), or nothing
   *   secondaryLabel  what Ctrl+Enter does here ('Open in new tab'), '' for none
   *   onOpen(item, secondary)
   *   onToggle(open)  the window opened or closed
   *   trigger         the search bar, or a function that returns it: focus goes
   *                   back there when nothing else opened the window
   *   full            true, false, or a function that answers either: whether
   *                   the window takes the whole screen. Left out, it does on
   *                   a screen narrower than 420px.
   *   ask             the surface's FiboChat, or nothing:
   *                     locked            a sentence when the account cannot ask yet, else ''
   *                     minLength         the shortest question it takes
   *                     show(el, question) draw the answer into el
   *                     hide(el)           take it out again
   *
   * Handle: open(text), close(), toggle(), isOpen(), refresh(), leaveAsk(), destroy().
   */
  function create(cfg) {
    var doc = root.document;
    var name = cfg.name || 'sbcp';
    var mod = isMac() ? '⌘' : 'Ctrl';
    var st = {
      open: false, ask: false, asked: null, input: '', query: '',
      activeKey: null, f: emptyFilters(), opener: null
    };
    var timer = null, closeTimer = null, menu = null, shown = [];

    var el = doc.createElement('div');
    el.className = 'sbcp';
    el.hidden = true;
    el.innerHTML =
      '<div class="sbcp-back"></div>' +
      '<div class="sbcp-dlg" role="dialog" aria-modal="true" aria-label="Search or ask">' +
        '<div class="sbcp-in">' +
          ICON.search +
          '<span class="sbcp-mode" hidden>' + ICON.spark + '<span translate="no">FiboChat</span></span>' +
          '<input class="sbcp-input" type="text" role="combobox" aria-expanded="false" aria-autocomplete="list"' +
            ' aria-controls="' + esc(name) + '-list" autocomplete="off" autocapitalize="off" spellcheck="false">' +
          (cfg.ask ? '<button type="button" class="sbcp-ai" aria-pressed="false" aria-label="Ask FiboChat" title="Ask FiboChat">' + ICON.spark + '</button>' : '') +
          '<button type="button" class="sbcp-close">Close</button>' +
        '</div>' +
        '<div class="sbcp-chips" role="group" aria-label="Filters"></div>' +
        '<div class="sbcp-list" role="listbox" id="' + esc(name) + '-list" aria-label="Results"></div>' +
        '<div class="sbcp-ask" hidden><div class="sbcp-ask-intro"></div><div class="sbcp-ask-host"></div></div>' +
        '<div class="sbcp-ft"></div>' +
      '</div>';
    (cfg.host || doc.body).appendChild(el);

    var dlg = el.querySelector('.sbcp-dlg');
    var input = el.querySelector('.sbcp-input');
    var listEl = el.querySelector('.sbcp-list');
    var chipsEl = el.querySelector('.sbcp-chips');
    var footEl = el.querySelector('.sbcp-ft');
    var aiBtn = el.querySelector('.sbcp-ai');
    var modeEl = el.querySelector('.sbcp-mode');
    var askEl = el.querySelector('.sbcp-ask');
    var askIntro = el.querySelector('.sbcp-ask-intro');
    var askHost = el.querySelector('.sbcp-ask-host');

    function items() { return list(cfg.items ? cfg.items() : []); }

    // A phone gets the whole screen: no backdrop, a Close button, no key hints.
    function wantsFull() {
      if (typeof cfg.full === 'function') return !!cfg.full();
      if (typeof cfg.full === 'boolean') return cfg.full;
      return !!(root.matchMedia && root.matchMedia('(max-width: 419px)').matches);
    }

    // On a phone the keyboard covers the foot of the page without making the
    // page any shorter. The window follows the part that can be seen, so its
    // last rows and its foot stay above the keyboard.
    function fit() {
      var view = root.visualViewport;
      if (!view || !st.open || !el.classList.contains('sbcp-full')) {
        el.style.top = '';
        el.style.height = '';
        return;
      }
      el.style.top = view.offsetTop + 'px';
      el.style.height = view.height + 'px';
    }
    function recentList() { return cfg.recents ? cfg.recents.list() : []; }
    function now() { return Date.now(); }
    function askMin() { return (cfg.ask && cfg.ask.minLength) || 1; }

    // Drawing

    function rowHtml(row, words, index) {
      var item = row.item, on = item.key === st.activeKey;
      var why = row.why ? rule().whyHtml(row.why) : '';
      return '<div class="sbcp-row' + (why ? ' sbcp-row-why' : '') + '" role="option" id="' + esc(name) + '-o-' + index + '"' +
        ' data-key="' + esc(item.key) + '" aria-selected="' + (on ? 'true' : 'false') + '">' +
          '<div class="sbcp-r1">' +
            (ICON[item.kind] || ICON.item) +
            '<span class="sbcp-t" translate="no">' + (words ? markTitle(item.title || 'Untitled', words) : esc(item.title || 'Untitled')) + '</span>' +
            '<span class="sbcp-c" translate="no">· ' + esc(crumb(item)) + '</span>' +
            (item.shortcut ? '<span class="sbcp-k" translate="no">' + esc(item.shortcut) + '</span>' : '') +
          '</div>' +
          (why ? '<div class="sbcp-w" translate="no">' + why + '</div>' : '') +
        '</div>';
    }

    function emptyHtml(query) {
      var on = filtersOn(st.f);
      var first = query
        ? 'No results for <b translate="no">“' + esc(query) + '”</b>.'
        : (on ? 'Nothing you opened lately matches these filters.' : 'Nothing opened yet.');
      var second = on
        ? 'Some filters are on and may hide what you want.'
        : (query ? 'Try fewer words, or a different one.' : 'Type to search your snippets, prompts and Brains.');
      return '<div class="sbcp-empty"><p>' + first + '</p><p>' + second + '</p>' +
        (on ? '<button type="button" class="sbcp-btn" data-clear-filters>Clear filters</button>' : '') + '</div>';
    }

    function skeletonHtml() {
      var out = '';
      for (var i = 0; i < 5; i++) {
        out += '<div class="sbcp-skel" aria-hidden="true"><i></i><i style="width:' + (34 + (i * 13) % 21) + '%"></i><i style="width:' + (13 + (i * 8) % 13) + '%"></i></div>';
      }
      return out;
    }

    function drawList(keep) {
      var all = items();
      if (!all.length && cfg.loading && cfg.loading()) {
        shown = [];
        st.activeKey = null;
        listEl.setAttribute('aria-busy', 'true');
        listEl.innerHTML = skeletonHtml();
        syncActive();
        return;
      }
      listEl.setAttribute('aria-busy', 'false');
      var query = st.query.replace(/^\s+|\s+$/g, '');
      var words = rule().words(query);
      var html = '', index = 0, keys = [];
      if (words.length) {
        var opened = {};
        recentList().forEach(function (row) { opened[row.k] = row.t; });
        var found = find(all, query, st.f, now(), opened);
        found.forEach(function (row) { keys.push(row.item.key); });
        if (!keep || keys.indexOf(st.activeKey) < 0) st.activeKey = keys[0] || null;
        found.forEach(function (row) { html += rowHtml(row, words, index++); });
      } else {
        var recent = recentRows(all, recentList(), st.f, now());
        recent.forEach(function (row) { keys.push(row.item.key); });
        if (!keep || keys.indexOf(st.activeKey) < 0) st.activeKey = keys[0] || null;
        recentsApi().group(recent, now(), function (row) { return row.at; }).forEach(function (group) {
          html += '<div class="sbcp-group" role="group" aria-label="' + esc(group.label) + '">' +
            '<div class="sbcp-g" aria-hidden="true">' + esc(group.label) + '</div>';
          group.rows.forEach(function (row) { html += rowHtml(row, null, index++); });
          html += '</div>';
        });
      }
      shown = keys;
      var top = listEl.scrollTop;
      listEl.innerHTML = keys.length ? html : emptyHtml(query);
      listEl.scrollTop = keep ? top : 0;
      syncActive();
      if (keep) reveal();
    }

    function chipHtml(key, label, on, menuChip) {
      var attrs = menuChip ? ' aria-haspopup="menu" aria-expanded="' + (menu && menu.key === key ? 'true' : 'false') + '"'
        : ' aria-pressed="' + (on ? 'true' : 'false') + '"';
      var body = (key === 'title' && on ? ICON.check : '') + '<span>' + label + '</span>' + (menuChip && !on ? ICON.down : '');
      if (!on) return '<button type="button" class="sbcp-chip" data-chip="' + key + '"' + attrs + '>' + body + '</button>';
      return '<span class="sbcp-chip sbcp-chip-on">' +
        '<button type="button" class="sbcp-chip-main" data-chip="' + key + '"' + attrs + '>' + body + '</button>' +
        '<button type="button" class="sbcp-chip-x" data-x="' + key + '" aria-label="Clear this filter">' + ICON.cross + '</button>' +
      '</span>';
    }

    function named(pairs, key) {
      for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === key) return pairs[i][1];
      return '';
    }

    function drawChips() {
      var f = st.f, fac = facets(items()), html = '';
      html += chipHtml('title', 'Title only', f.titleOnly, false);
      // One person in the whole library leaves nothing to choose between.
      if (fac.people.length > 1 || f.by.length) {
        html += chipHtml('by', f.by.length
          ? 'Created by: <span translate="no">' + esc(f.by.length === 1 ? f.by[0] : '') + '</span>' + (f.by.length === 1 ? '' : f.by.length + ' people')
          : 'Created by', f.by.length > 0, true);
      }
      if (fac.places.length || f.places.length) {
        var one = '';
        if (f.places.length === 1) fac.places.forEach(function (p) { if (p.key === f.places[0]) one = p.name; });
        html += chipHtml('in', f.places.length
          ? 'In: ' + (one ? '<span translate="no">' + esc(one) + '</span>' : f.places.length + ' places')
          : 'In', f.places.length > 0, true);
      }
      f.more.forEach(function (key) {
        if (key === 'type') {
          html += chipHtml('type', f.types.length
            ? 'Type: <span translate="no">' + esc(f.types.map(function (t) { return named(TYPES, t); }).join(', ')) + '</span>'
            : 'Type', true, true);
        } else if (key === 'labels') {
          html += chipHtml('labels', f.labels.length
            ? 'Labels: ' + (f.labels.length === 1 ? '<span translate="no">' + esc(f.labels[0]) + '</span>' : f.labels.length + ' labels')
            : 'Labels', true, true);
        } else if (key === 'edited') {
          html += chipHtml('edited', f.edited ? 'Edited: ' + esc(named(EDITED, f.edited)) : 'Date edited', true, true);
        }
      });
      html += '<button type="button" class="sbcp-chip sbcp-chip-add" data-chip="add" aria-haspopup="menu" aria-expanded="' +
        (menu && menu.key === 'add' ? 'true' : 'false') + '">' + ICON.plus + '<span>Filter</span></button>';
      chipsEl.innerHTML = html;
    }

    function kbd(text) { return '<kbd translate="no">' + text + '</kbd>'; }

    function drawFooter() {
      var hints = st.ask
        ? '<span class="sbcp-hint">' + kbd('↵') + ' Ask</span><span class="sbcp-hint">' + kbd('Esc') + ' Close</span>'
        : '<span class="sbcp-hint">' + kbd('↑') + kbd('↓') + ' Navigate</span>' +
          '<span class="sbcp-hint">' + kbd('↵') + ' Open</span>' +
          (cfg.secondaryLabel ? '<span class="sbcp-hint">' + kbd(mod + ' ↵') + ' ' + esc(cfg.secondaryLabel) + '</span>' : '') +
          '<span class="sbcp-hint">' + kbd('Esc') + ' Close</span>';
      footEl.innerHTML = hints + (cfg.recents
        ? '<button type="button" class="sbcp-gear" data-gear aria-label="Search settings" title="Search settings" aria-haspopup="menu" aria-expanded="' +
          (menu && menu.key === 'gear' ? 'true' : 'false') + '">' + ICON.gear + '</button>'
        : '');
    }

    function drawAsk() {
      var text = st.input.replace(/^\s+|\s+$/g, '');
      var locked = cfg.ask.locked || '';
      var ready = !locked && text.length >= askMin();
      askIntro.hidden = st.asked !== null;
      askHost.hidden = st.asked === null;
      askIntro.innerHTML =
        '<p class="sbcp-ask-t">' + ICON.spark + 'Ask <span translate="no">FiboChat</span></p>' +
        '<p>Type a question in your own words. The answer comes only from your snippets and Brains, with every source linked.</p>' +
        (locked
          ? '<p class="sbcp-ask-lock">' + esc(locked) + '</p>'
          : '<button type="button" class="sbcp-btn sbcp-btn-go" data-ask-go' + (ready ? '' : ' disabled') + '>Ask</button>');
    }

    function draw(keep) {
      el.classList.toggle('sbcp-asking', st.ask);
      modeEl.hidden = !st.ask;
      if (aiBtn) aiBtn.setAttribute('aria-pressed', st.ask ? 'true' : 'false');
      input.placeholder = st.ask ? 'Ask a question about your snippets and Brains…' : 'Search or ask a question…';
      input.setAttribute('aria-label', st.ask ? 'Ask a question' : 'Search or ask a question');
      listEl.hidden = st.ask;
      chipsEl.hidden = st.ask;
      askEl.hidden = !st.ask;
      drawChips();
      drawFooter();
      if (st.ask) {
        shown = [];
        st.activeKey = null;
        syncActive();
        drawAsk();
      } else {
        drawList(keep);
      }
    }

    // The highlighted row: one for the keys and the mouse

    function rows() { return Array.prototype.slice.call(listEl.querySelectorAll('[role="option"]')); }

    function syncActive() {
      var active = null;
      rows().forEach(function (row) {
        var on = row.getAttribute('data-key') === st.activeKey;
        row.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) active = row;
      });
      input.setAttribute('aria-expanded', shown.length ? 'true' : 'false');
      if (active) input.setAttribute('aria-activedescendant', active.id);
      else input.removeAttribute('aria-activedescendant');
    }

    function reveal() {
      var row = listEl.querySelector('[aria-selected="true"]');
      if (!row) return;
      var top = row.offsetTop, bottom = top + row.offsetHeight;
      if (top < listEl.scrollTop) listEl.scrollTop = Math.max(0, top - 4);
      else if (bottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight + 4;
    }

    function setActive(key, scroll) {
      if (shown.indexOf(key) < 0) return;
      st.activeKey = key;
      syncActive();
      if (scroll) reveal();
    }

    function move(step) {
      if (!shown.length) return;
      var at = shown.indexOf(st.activeKey);
      at = Math.max(0, Math.min(shown.length - 1, (at < 0 ? 0 : at) + step));
      setActive(shown[at], true);
    }

    function openItem(key, secondary) {
      var found = null;
      items().forEach(function (item) { if (item.key === key) found = item; });
      if (!found) return;
      if (cfg.recents) cfg.recents.record(key);
      close();
      if (cfg.onOpen) cfg.onOpen(found, !!secondary);
    }

    // Typing

    // The box shows every key at once; the list follows after a short pause,
    // so a long library is never searched once per letter.
    function commit() {
      if (timer !== null) { root.clearTimeout(timer); timer = null; }
      if (st.query !== st.input) { st.query = st.input; drawList(false); }
    }

    function onInput() {
      st.input = input.value;
      if (st.ask) {
        if (st.asked !== null) hideAnswer();
        drawAsk();
        return;
      }
      if (timer !== null) root.clearTimeout(timer);
      timer = root.setTimeout(commit, DEBOUNCE_MS);
    }

    // Ask

    function hideAnswer() {
      if (st.asked === null) return;
      st.asked = null;
      if (cfg.ask && cfg.ask.hide) cfg.ask.hide(askHost);
    }

    function askNow() {
      var text = st.input.replace(/^\s+|\s+$/g, '');
      if (!cfg.ask || cfg.ask.locked || text.length < askMin()) return;
      hideAnswer();
      st.asked = text;
      drawAsk();
      cfg.ask.show(askHost, text);
    }

    function setAsk(on) {
      if (!cfg.ask || st.ask === on) return;
      closeMenu();
      hideAnswer();
      st.ask = on;
      if (!on) { if (timer !== null) { root.clearTimeout(timer); timer = null; } st.query = st.input; }
      draw(false);
      input.focus();
    }

    // Menus: under a chip, or over the settings button

    function optHtml(group, value, label, on, single, plain) {
      return '<button type="button" role="' + (single ? 'menuitemradio' : 'menuitemcheckbox') + '" aria-checked="' + (on ? 'true' : 'false') + '"' +
        ' data-opt="' + group + '" data-val="' + esc(value) + '"><span class="sbcp-box"></span>' +
        '<span' + (plain ? '' : ' translate="no"') + '>' + esc(label) + '</span></button>';
    }

    function menuHtml(key) {
      var f = st.f, fac = facets(items()), html = '';
      if (key === 'by') {
        fac.people.forEach(function (who) { html += optHtml('by', who, who, f.by.indexOf(who) > -1, false, who === 'You'); });
      } else if (key === 'in') {
        var section = '';
        ['Snippets', 'Prompts', 'Brains'].forEach(function (wanted) {
          fac.places.forEach(function (place) {
            if (place.section !== wanted) return;
            if (section !== wanted) { section = wanted; html += '<div class="sbcp-mh" translate="no">' + wanted + '</div>'; }
            html += optHtml('in', place.key, place.name, f.places.indexOf(place.key) > -1, false, false);
          });
        });
      } else if (key === 'type') {
        TYPES.forEach(function (t) { html += optHtml('type', t[0], t[1], f.types.indexOf(t[0]) > -1, false, false); });
      } else if (key === 'labels') {
        fac.labels.forEach(function (label) { html += optHtml('labels', label, label, f.labels.indexOf(label) > -1, false, false); });
      } else if (key === 'edited') {
        EDITED.forEach(function (e) { html += optHtml('edited', e[0], e[1], f.edited === e[0], true, true); });
      } else if (key === 'add') {
        html += '<div class="sbcp-mh">Add a filter</div>';
        MORE.forEach(function (m) {
          if (m[0] === 'labels' && !fac.labels.length && f.more.indexOf('labels') < 0) return;
          if (m[0] === 'edited' && !fac.edited && f.more.indexOf('edited') < 0) return;
          html += optHtml('add', m[0], m[1], f.more.indexOf(m[0]) > -1, false, true);
        });
      } else if (key === 'gear') {
        html += '<div class="sbcp-note">What you opened lately is kept on this device only.</div>' +
          '<button type="button" role="menuitem" data-clear-recents>Clear recently opened</button>';
      }
      return html;
    }

    function anchorOf(key) {
      return key === 'gear' ? footEl.querySelector('[data-gear]') : chipsEl.querySelector('[data-chip="' + key + '"]');
    }

    function placeMenu() {
      var anchor = anchorOf(menu.key);
      if (!anchor) return;
      var a = anchor.getBoundingClientRect(), d = dlg.getBoundingClientRect(), box = menu.el;
      var left = a.left - d.left, top = a.bottom - d.top + 4;
      if (menu.key === 'gear') {
        left = a.right - d.left - box.offsetWidth;
        top = a.top - d.top - box.offsetHeight - 4;
      } else {
        box.style.maxHeight = Math.max(89, dlg.clientHeight - top - 8) + 'px';
      }
      box.style.left = Math.max(8, Math.min(left, dlg.clientWidth - box.offsetWidth - 8)) + 'px';
      box.style.top = Math.max(8, top) + 'px';
    }

    function openMenu(key, focusValue) {
      closeMenu();
      var box = doc.createElement('div');
      box.className = 'sbcp-menu';
      box.setAttribute('role', 'menu');
      box.innerHTML = menuHtml(key);
      dlg.appendChild(box);
      menu = { key: key, el: box };
      placeMenu();
      var anchor = anchorOf(key);
      if (anchor) anchor.setAttribute('aria-expanded', 'true');
      var wanted = null;
      if (focusValue !== undefined) {
        Array.prototype.forEach.call(box.querySelectorAll('[data-val]'), function (b) {
          if (b.getAttribute('data-val') === focusValue) wanted = b;
        });
      }
      var first = wanted || box.querySelector('button');
      if (first) first.focus();
    }

    function closeMenu(refocus) {
      if (!menu) return false;
      var key = menu.key;
      menu.el.parentNode.removeChild(menu.el);
      menu = null;
      var anchor = anchorOf(key);
      if (anchor) anchor.setAttribute('aria-expanded', 'false');
      if (refocus) (anchor || input).focus();
      return true;
    }

    function toggleIn(arr, value) {
      var at = arr.indexOf(value);
      if (at > -1) arr.splice(at, 1); else arr.push(value);
    }

    function clearChip(key) {
      var f = st.f;
      if (key === 'title') f.titleOnly = false;
      else if (key === 'by') f.by = [];
      else if (key === 'in') f.places = [];
      else {
        f.more = f.more.filter(function (k) { return k !== key; });
        if (key === 'type') f.types = [];
        if (key === 'labels') f.labels = [];
        if (key === 'edited') f.edited = null;
      }
    }

    function pick(button) {
      var group = button.getAttribute('data-opt'), value = button.getAttribute('data-val'), f = st.f;
      var key = menu.key;
      if (group === 'add') {
        if (f.more.indexOf(value) > -1) {
          clearChip(value);
          closeMenu();
          draw(false);
          input.focus();
          return;
        }
        f.more.push(value);
        closeMenu();
        draw(false);
        openMenu(value);
        return;
      }
      if (group === 'by') toggleIn(f.by, value);
      else if (group === 'in') toggleIn(f.places, value);
      else if (group === 'type') toggleIn(f.types, value);
      else if (group === 'labels') toggleIn(f.labels, value);
      else if (group === 'edited') f.edited = f.edited === value ? null : value;
      closeMenu();
      draw(false);
      // The menu stays open on the choice just made, so several can be ticked.
      openMenu(key, value);
    }

    // Keys

    // What Tab can land on: nothing switched off, nothing put away, and not
    // the Close button while the stylesheet keeps it for narrow screens.
    function focusables() {
      return Array.prototype.filter.call(dlg.querySelectorAll('input, button'), function (node) {
        if (node.disabled || node.closest('[hidden]')) return false;
        return !root.getComputedStyle || root.getComputedStyle(node).display !== 'none';
      });
    }

    function trap(e) {
      var nodes = focusables();
      if (!nodes.length) return;
      e.preventDefault();
      var at = nodes.indexOf(doc.activeElement);
      nodes[(at + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length].focus();
    }

    function onKeyDown(e) {
      // Nothing typed here reaches the page underneath: the popup and the
      // dashboard both listen for the same keys on their own lists.
      e.stopPropagation();
      var key = e.key, withMod = e.ctrlKey || e.metaKey;
      if (withMod && String(key).toLowerCase() === 'k') { e.preventDefault(); close(); return; }
      if (key === 'Escape') {
        e.preventDefault();
        if (closeMenu(true)) return;
        if (input.value) {
          input.value = '';
          st.input = '';
          if (st.ask) { hideAnswer(); drawAsk(); } else commit();
          input.focus();
          return;
        }
        close();
        return;
      }
      if (key === 'Tab') { trap(e); return; }
      if (menu) {
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          e.preventDefault();
          var buttons = Array.prototype.slice.call(menu.el.querySelectorAll('button'));
          var at = buttons.indexOf(doc.activeElement);
          var next = buttons[Math.max(0, Math.min(buttons.length - 1, at + (key === 'ArrowDown' ? 1 : -1)))];
          if (next) next.focus();
        }
        return;
      }
      if (doc.activeElement !== input) return;
      if (st.ask) {
        if (key === 'Enter') { e.preventDefault(); askNow(); }
        return;
      }
      if (key === 'ArrowDown') { e.preventDefault(); commit(); move(1); }
      else if (key === 'ArrowUp') { e.preventDefault(); commit(); move(-1); }
      else if (key === 'Enter') {
        e.preventDefault();
        commit();
        if (st.activeKey) openItem(st.activeKey, withMod);
      }
    }

    function onClick(e) {
      var target = e.target;
      function near(selector) { return target.closest ? target.closest(selector) : null; }
      if (near('.sbcp-back')) { close(); return; }
      if (near('.sbcp-close')) { close(); return; }
      if (near('.sbcp-ai')) { setAsk(!st.ask); return; }
      var option = near('[data-opt]');
      if (option) { pick(option); return; }
      if (near('[data-clear-recents]')) {
        cfg.recents.clear();
        closeMenu();
        draw(false);
        input.focus();
        return;
      }
      var gear = near('[data-gear]');
      if (gear) {
        if (menu && menu.key === 'gear') closeMenu(true); else openMenu('gear');
        return;
      }
      var cross = near('[data-x]');
      if (cross) {
        clearChip(cross.getAttribute('data-x'));
        closeMenu();
        draw(false);
        input.focus();
        return;
      }
      var chip = near('[data-chip]');
      if (chip) {
        var key = chip.getAttribute('data-chip');
        if (key === 'title') {
          st.f.titleOnly = !st.f.titleOnly;
          closeMenu();
          draw(false);
          var again = chipsEl.querySelector('[data-chip="title"]');
          if (again) again.focus();
          return;
        }
        if (menu && menu.key === key) closeMenu(true); else openMenu(key);
        return;
      }
      if (near('[data-clear-filters]')) {
        st.f = emptyFilters();
        closeMenu();
        draw(false);
        input.focus();
        return;
      }
      if (near('[data-ask-go]')) { askNow(); return; }
      var row = near('[role="option"]');
      if (row) { openItem(row.getAttribute('data-key'), e.ctrlKey || e.metaKey); return; }
      // A click anywhere else in the window puts an open menu away.
      if (menu && !near('.sbcp-menu')) closeMenu();
    }

    function onMouseMove(e) {
      var row = e.target.closest ? e.target.closest('[role="option"]') : null;
      if (row && row.getAttribute('data-key') !== st.activeKey) setActive(row.getAttribute('data-key'), false);
    }

    input.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('click', onClick);
    listEl.addEventListener('mousemove', onMouseMove);

    // Opening and closing

    function open(text) {
      if (st.open) { input.focus(); return; }
      if (closeTimer !== null) { root.clearTimeout(closeTimer); closeTimer = null; }
      st.open = true;
      st.opener = doc.activeElement;
      st.ask = false;
      st.asked = null;
      // Filters start clean: one left on from last time would hide results
      // without saying so.
      st.f = emptyFilters();
      st.input = st.query = typeof text === 'string' ? text : '';
      st.activeKey = null;
      input.value = st.input;
      el.hidden = false;
      el.classList.toggle('sbcp-full', wantsFull());
      if (root.visualViewport) root.visualViewport.addEventListener('resize', fit);
      fit();
      draw(false);
      // Painted closed first, so the fade and the small scale have a start.
      void el.offsetWidth;
      el.classList.add('sbcp-on');
      input.focus();
      try { input.setSelectionRange(st.input.length, st.input.length); } catch (err) { /* not every input type takes a selection */ }
      if (cfg.onToggle) cfg.onToggle(true);
    }

    function close() {
      if (!st.open) return;
      closeMenu();
      hideAnswer();
      if (timer !== null) { root.clearTimeout(timer); timer = null; }
      st.open = false;
      if (root.visualViewport) root.visualViewport.removeEventListener('resize', fit);
      el.classList.remove('sbcp-on');
      var still = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      closeTimer = root.setTimeout(function () {
        closeTimer = null;
        if (!st.open) el.hidden = true;
      }, still ? 0 : CLOSE_MS);
      var trigger = typeof cfg.trigger === 'function' ? cfg.trigger() : cfg.trigger;
      var back = st.opener && st.opener !== doc.body && doc.contains(st.opener) ? st.opener : trigger;
      st.opener = null;
      if (back && back.focus) back.focus();
      if (cfg.onToggle) cfg.onToggle(false);
    }

    /** The library or the recents changed: draw again, the highlight stays on its item. */
    function refresh() {
      if (!st.open) return;
      var key = menu ? menu.key : null;
      var focused = menu && doc.activeElement && doc.activeElement.getAttribute ? doc.activeElement.getAttribute('data-val') : undefined;
      closeMenu();
      draw(true);
      if (key && anchorOf(key)) openMenu(key, focused === null ? undefined : focused);
    }

    if (cfg.recents) cfg.recents.ready(refresh);

    return {
      open: open,
      close: close,
      toggle: function (text) { if (st.open) close(); else open(text); },
      isOpen: function () { return st.open; },
      refresh: refresh,
      leaveAsk: function () { setAsk(false); },
      destroy: function () {
        if (timer !== null) root.clearTimeout(timer);
        if (closeTimer !== null) root.clearTimeout(closeTimer);
        if (root.visualViewport) root.visualViewport.removeEventListener('resize', fit);
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  var API = {
    DEBOUNCE_MS: DEBOUNCE_MS,
    create: create,
    crumb: crumb,
    emptyFilters: emptyFilters,
    editedIn: editedIn,
    passes: passes,
    facets: facets,
    find: find,
    recentRows: recentRows,
    markTitle: markTitle
  };

  // UMD: browser globals, CommonJS (the node gate and the dashboard's test).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBCommandPalette = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));

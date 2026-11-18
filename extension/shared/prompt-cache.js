// THE PROMPT MENU'S LIST, AS THE EXTENSION KEEPS IT.
//
// The """ menu on a page reads the person's prompts from one place,
// chrome.storage.local.sb_prompts, and updates itself whenever that changes.
// Two writers fill it: the popup, when it is opened, and the service worker,
// on its own refreshes (a tab switch, the 5 minute timer, and the moment a
// trigger is typed on a page). Until the worker wrote it too, a prompt created
// on the dashboard reached the menu only once the popup had been opened.
//
// Both writers go through this file, so the menu is handed the same rows in
// the same order whoever wrote last.
(function (root) {
  'use strict';

  var KEY = 'sb_prompts';

  // What the worker asks for: the columns toRows reads and nothing more.
  // Archived prompts are kept to be restored, not offered. Newest first, the
  // order the popup's own read uses, so the list does not reshuffle between
  // one writer and the other.
  var QUERY = 'select=id,name,content,shortcut,review_status' +
    '&review_status=neq.archived&order=updated_at.desc';

  /** public.prompts rows in, the menu's rows out (name -> title, content -> body). */
  function toRows(prompts) {
    var list = Array.isArray(prompts) ? prompts : [];
    return list.map(function (p) {
      return {
        id: p.id,
        title: p.name || 'Untitled',
        body: p.content || '',
        shortcut: p.shortcut || '',
        review_status: p.review_status || 'approved'
      };
    });
  }

  var API = { KEY: KEY, QUERY: QUERY, toRows: toRows };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBPromptCache = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));

// review-prompt.js: when to ask a free account for a Chrome Web Store review.
//
// One short line and a button, shown to a free account after 10 sign-ins, at
// most 5 times. The rule is decided once, here, and copied for the dashboard in
// app/src/lib/reviewPrompt.ts:
//
//   extension/popup/popup.js         popup card (this module)
//   app/src/lib/reviewPrompt.ts      dashboard banner (TS copy)
//
// app/src/__tests__/reviewPrompt.test.ts loads this file and the copy and runs
// the same cases over both, so the two surfaces cannot show it at different
// moments.
//
// The numbers live on the server, per person (services/supabase/migrations/
// 20261027140000_review_prompt.sql): sign-ins are counted by a trigger, and
// review_prompt_record_view() holds the cap of MAX_VIEWS on its own, so even a
// client that decided wrongly could not show it a sixth time.
//
// Every answer fails closed. A missing, malformed or unreadable field hides the
// prompt: a review request that does not appear costs nothing, one that appears
// to the wrong person does.
(function(root) {
  'use strict';

  var START_LOGIN = 10;
  var MAX_VIEWS = 5;
  var PLAN_FREE = 'free';
  var REVIEW_URL = 'https://chromewebstore.google.com/detail/fibonax/khdpimdpkgmmaimpbfjgglnpaemmopoo/reviews';
  var MESSAGE = "You're using an enterprise tool for free.";
  var REVIEW_LABEL = 'Leave us a review :)';
  // What a screen reader says: the same words without the smiley.
  var REVIEW_ARIA_LABEL = 'Leave us a review';
  var STOP_LABEL = "Don't ask again";

  // The two reasons the server keeps for a stop.
  var STOP_REVIEWED = 'reviewed';
  var STOP_DISMISSED = 'dismissed';

  // The server's one-row answer to review_prompt_status(), in the shape the
  // rule reads. Anything else is null, which shouldShow() hides.
  function readStatus(body) {
    var row = Array.isArray(body) ? body[0] : body;
    if (!row || typeof row !== 'object') return null;
    if (typeof row.login_count !== 'number' || typeof row.view_count !== 'number') return null;
    if (typeof row.stopped !== 'boolean' || typeof row.viewed_this_session !== 'boolean') return null;
    if (typeof row.plan !== 'string') return null;
    return {
      loginCount: row.login_count,
      viewCount: row.view_count,
      stopped: row.stopped,
      plan: row.plan,
      viewedThisSession: row.viewed_this_session
    };
  }

  // True when the prompt may be drawn now. Drawing it is a separate step: the
  // caller must still win review_prompt_record_view(), and draws only on true.
  function shouldShow(state) {
    if (!state) return false;
    if (state.plan !== PLAN_FREE) return false;
    if (state.stopped !== false) return false;
    if (state.viewedThisSession !== false) return false;
    if (!(state.loginCount >= START_LOGIN)) return false;
    if (!(state.viewCount < MAX_VIEWS)) return false;
    return true;
  }

  var API = {
    START_LOGIN: START_LOGIN,
    MAX_VIEWS: MAX_VIEWS,
    PLAN_FREE: PLAN_FREE,
    REVIEW_URL: REVIEW_URL,
    MESSAGE: MESSAGE,
    REVIEW_LABEL: REVIEW_LABEL,
    REVIEW_ARIA_LABEL: REVIEW_ARIA_LABEL,
    STOP_LABEL: STOP_LABEL,
    STOP_REVIEWED: STOP_REVIEWED,
    STOP_DISMISSED: STOP_DISMISSED,
    readStatus: readStatus,
    shouldShow: shouldShow
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    root.SBReviewPrompt = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));

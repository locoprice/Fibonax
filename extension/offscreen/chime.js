// chime.js: the Pomodoro timer's chime.
//
// A Manifest V3 service worker cannot play sound, so background.js opens this
// page as an offscreen document (sbFocusChime) when a work session or a break
// ends, and it plays as soon as it loads. The tones are decided once, in
// shared/focus-timer.js, which the phone plays too. Chrome closes the page by
// itself after 30 silent seconds.
(function() {
  'use strict';
  try {
    var ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    SBFocus.playChime(ctx);
  } catch (e) {
    console.error('[Fibonax] Could not play the Pomodoro timer chime:', e);
  }
})();

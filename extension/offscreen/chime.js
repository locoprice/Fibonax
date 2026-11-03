// chime.js: the Pomodoro timer's chime.
//
// A Manifest V3 service worker cannot play sound, so background.js opens this
// page as an offscreen document (sbFocusChime) when a work session or a break
// ends, and it plays as soon as it loads. Two soft bell tones made by the
// browser, so the extension ships no sound file. Chrome closes the page by
// itself after 30 silent seconds.
(function() {
  'use strict';
  try {
    var ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    [[880, 0], [1318.5, 0.18]].forEach(function(tone) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var at = ctx.currentTime + tone[1];
      osc.type = 'sine';
      osc.frequency.value = tone[0];
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 1.7);
    });
  } catch (e) {
    console.error('[Fibonax] Could not play the Pomodoro timer chime:', e);
  }
})();

// photo.js: the page where someone chooses their detox day pictures.
//
// Opened from the Pomodoro timer in the popup. It is a page of its own because
// a file picker opened from inside the popup can close the popup on some
// computers. Pictures are added as soon as they are chosen. Each is shrunk here
// to at most SBFocus.PHOTO_MAX_SIDE pixels on its longest side and saved as a
// JPEG, up to SBFocus.PHOTO_MAX of them, in chrome.storage.local under
// SBFocus.PHOTO_KEY. They never leave this device. The page shows them in the
// same carousel the call and the break screen use.
(function() {
  'use strict';

  var F = window.SBFocus;
  var stored = null;   // what is saved, as last read
  var gallery = null;  // the carousel on screen, if any

  function el(id) { return document.getElementById(id); }

  function say(text, isError) {
    var s = el('ph-status');
    s.textContent = text;
    s.classList.toggle('err', !!isError);
  }

  // Draws what is saved: the carousel (or a single picture, or the empty
  // message), the count, and the buttons that belong to it.
  function render(start) {
    var urls = F.photoUrls(stored);
    var n = urls.length;
    var frame = el('ph-frame');
    if (gallery) { gallery.destroy(); gallery = null; }
    if (n) {
      gallery = SBFocusCarousel.create(urls, { start: start || 0 });
      frame.appendChild(gallery.el);
    }
    frame.classList.toggle('has', n > 0);
    el('ph-empty').hidden = n > 0;
    el('ph-count').textContent = n ? n + ' of ' + F.PHOTO_MAX + ' pictures saved' : '';
    el('ph-add').textContent = n ? 'Add more pictures' : 'Choose pictures';
    el('ph-add').classList.toggle('primary', n === 0);
    el('ph-remove').hidden = n === 0;
    el('ph-remove').textContent = n > 1 ? 'Remove this picture' : 'Remove picture';
  }

  function load(done) {
    chrome.storage.local.get(F.PHOTO_KEY, function(d) {
      if (chrome.runtime.lastError) {
        console.error('[Fibonax] Could not read the detox day pictures:', chrome.runtime.lastError.message);
        say('Could not read your pictures. Reload this page to try again.', true);
        return;
      }
      stored = d ? d[F.PHOTO_KEY] : null;
      done();
    });
  }

  function save(next, done) {
    var patch = {};
    patch[F.PHOTO_KEY] = next;
    chrome.storage.local.set(patch, function() {
      if (chrome.runtime.lastError) {
        console.error('[Fibonax] Could not save the detox day pictures:', chrome.runtime.lastError.message);
        say('Could not save. Remove a picture or try smaller ones.', true);
        return;
      }
      stored = next;
      done();
    });
  }

  // A phone photo can be 10 MB or more; a screen needs far less. The JPEG sits
  // on a white ground so a transparent picture does not turn black.
  function shrink(file) {
    return createImageBitmap(file).then(function(bitmap) {
      var scale = Math.min(1, F.PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', F.PHOTO_QUALITY);
    });
  }

  // One file at a time: ten phone photos decoded together can run a computer
  // out of memory. A file that is not a picture, or cannot be opened, is null.
  function readAll(files) {
    var out = [];
    return files.reduce(function(chain, file) {
      return chain.then(function() {
        if (!/^image\//.test(file.type)) { out.push(null); return null; }
        return shrink(file).then(function(url) { out.push(url); }, function(e) {
          console.error('[Fibonax] Could not open the picture:', e);
          out.push(null);
        });
      });
    }, Promise.resolve()).then(function() { return out; });
  }

  el('ph-add').addEventListener('click', function() {
    if (F.photoItems(stored).length >= F.PHOTO_MAX) {
      say('You have ' + F.PHOTO_MAX + ' pictures, the most Fibonax keeps. Remove one to add another.', true);
      return;
    }
    el('ph-file').click();
  });

  el('ph-file').addEventListener('change', function() {
    var input = el('ph-file');
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!files.length) return;
    // Only as many as fit are opened; the rest are counted, not decoded.
    var room = Math.max(0, F.PHOTO_MAX - F.photoItems(stored).length);
    var toRead = files.slice(0, room);
    var leftOut = files.length - toRead.length;
    say('Preparing your ' + (toRead.length === 1 ? 'picture' : 'pictures'));
    readAll(toRead).then(function(urls) {
      var good = urls.filter(Boolean);
      var unreadable = urls.length - good.length;
      // Read again right before saving, so a change made in another tab is kept.
      load(function() {
        var before = F.photoItems(stored).length;
        var result = F.addPhotos(stored, good, Date.now());
        var note = F.photoNote({
          added: result.added, duplicates: result.duplicates, unreadable: unreadable, full: result.full + leftOut
        });
        if (!result.added) { say(note, true); return; }
        save(result.stored, function() {
          render(before);
          say(note);
        });
      });
    });
  });

  el('ph-remove').addEventListener('click', function() {
    if (!gallery) return;
    var at = gallery.index();
    load(function() {
      var items = F.photoItems(stored);
      var target = items[at];
      if (!target) { render(0); return; }
      save(F.removePhoto(stored, target.id), function() {
        render(Math.min(at, F.photoItems(stored).length - 1));
        say('Picture removed.');
      });
    });
  });

  load(function() { render(0); });
})();

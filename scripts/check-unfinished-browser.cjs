// Browser regression check for the unfinished-text warning in the page.
// Run with Playwright available (require('playwright')). CHROME_PATH optionally
// selects an installed Chrome; UNFINISHED_SCREENSHOTS saves what it saw.
// All snippet data is fake; the shipping content scripts run with a local
// chrome.storage/runtime stand-in, as in check-expansion-summary.cjs.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = process.env.UNFINISHED_SCREENSHOTS;
const library = [
  { id: 'clean', shortcut: 'clean', title: 'Clean', lang: 'EN', body: 'Hello, your message is ready.' },
  { id: 'gap', shortcut: 'gap', title: 'Gap', lang: 'EN', body: 'Hello [xxx], your order is ready.' },
  { id: 'quiet', shortcut: 'quiet', title: 'Quiet', lang: 'EN', body: 'Reference XXX on purpose.', check_unfinished: false },
  { id: 'form', shortcut: 'form', title: 'Form', lang: 'EN', body: 'Dear {formtext: name=Client},\nPhone: {formtext: name=Phone}\nThanks.' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setContent('<html><body style="margin:0;background:#fafafa;font:16px system-ui;padding:24px;box-sizing:border-box"><h1>Message</h1><textarea id="editor" aria-label="Plain message" style="box-sizing:border-box;width:100%;height:120px"></textarea><div id="rich" contenteditable="true" role="textbox" aria-label="Formatted message" style="min-height:80px;border:1px solid #ccc;padding:8px;margin-top:12px"></div></body></html>');
    await page.evaluate((snippets) => {
      window.sent = [];
      window.answerMute = true;
      window.chrome = {
        storage: { local: { get: (keys, cb) => cb({ snippets, sb_session: { user_id: 'fixture' } }), set: () => {} }, onChanged: { addListener: () => {} } },
        runtime: {
          id: 'fixture',
          lastError: null,
          sendMessage: (msg, cb) => {
            window.sent.push(msg);
            if (msg && msg.type === 'snippet_check_unfinished' && cb) setTimeout(() => cb({ ok: window.answerMute }), 30);
          },
          onMessage: { addListener: () => {} },
        },
      };
    }, library);
    await page.addStyleTag({ path: root + '/extension/shared/tokens/colors_and_type.css' });
    await page.addStyleTag({ path: root + '/extension/shared/fill-form-ui.css' });
    for (const file of ['formula-engine.js', 'shared/snippet-stats.js', 'shared/fill-form.js', 'shared/fill-form-ui.js', 'shared/interactive-steps.js', 'content/content.js']) {
      await page.addScriptTag({ path: root + '/extension/' + file });
    }

    const shot = async (name) => { if (output) await page.screenshot({ path: path.join(output, name + '.png') }); };
    // Presses the summary card's main button: Insert text on a plain box, where
    // the text waits for it, or Done once it is already in.
    const settle = async () => {
      await page.waitForSelector('#sb-cel-ok');
      await page.click('#sb-cel-ok');
      await page.waitForTimeout(50);
    };
    async function typeIn(selector, text) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el.tagName === 'TEXTAREA') el.value = ''; else el.textContent = '';
        el.focus();
      }, selector);
      await page.keyboard.type(text, { delay: 15 });
      // A typed shortcut settles before it expands (MATCH_SETTLE_MS).
      await page.waitForTimeout(600);
    }
    const value = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el.tagName === 'TEXTAREA' ? el.value : el.innerText; }, sel);
    const dialogOpen = () => page.evaluate(() => !!document.getElementById('ff-unf'));

    // 1. A finished snippet goes straight through, exactly as before.
    await typeIn('#editor', '::clean');
    assert.equal(await dialogOpen(), false, 'a finished snippet opens no warning');
    assert.ok(await page.evaluate(() => !!document.getElementById('sb-celebrate')), 'the summary card opens as before');
    await settle();
    assert.equal(await value('#editor'), 'Hello, your message is ready.');
    console.log('OK A finished snippet inserts with no warning');

    // 2. A gap opens the warning before anything is inserted.
    await typeIn('#editor', '::gap');
    assert.equal(await dialogOpen(), true, 'the warning opens');
    assert.equal(await page.evaluate(() => document.getElementById('sb-celebrate')), null, 'nothing is inserted while it is open');
    const list = await page.$$eval('#ff-unf .ff-unf-piece', (n) => n.map((x) => x.textContent));
    assert.deepEqual(list, ['[xxx]']);
    assert.equal(await page.$eval('#ff-unf .ff-unf-primary', (b) => b.textContent), 'Edit snippet');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.className), 'ff-unf-primary', 'the safe choice holds the focus');
    await shot('1-warning-no-form');
    // Esc goes back, as the summary card's Cancel does: the trigger comes out
    // and nothing goes in.
    await page.keyboard.press('Escape');
    assert.equal(await dialogOpen(), false);
    assert.equal(await value('#editor'), '', 'going back inserts nothing');
    console.log('OK A gap warns first; going back inserts nothing');

    // 3. Insert anyway in a plain box.
    await typeIn('#editor', '::gap');
    await page.click('#ff-unf .ff-unf-secondary');
    await page.waitForTimeout(50);
    await settle();
    assert.equal(await value('#editor'), 'Hello [xxx], your order is ready.');
    console.log('OK Insert anyway inserts the text as written');

    // 4. Insert anyway in a rich editor lands where the trigger was.
    await page.evaluate(() => { const r = document.querySelector('#rich'); r.textContent = ''; r.focus(); });
    await page.keyboard.type('Before ', { delay: 10 });
    await page.keyboard.type('::gap', { delay: 15 });
    await page.waitForTimeout(600);
    assert.equal(await dialogOpen(), true);
    await page.click('#ff-unf .ff-unf-secondary');
    await page.waitForTimeout(100);
    await settle();
    assert.equal((await value('#rich')).trim(), 'Before Hello [xxx], your order is ready.', 'the text replaces the trigger in a rich editor');
    // Going back in a rich editor matches the plain box.
    await page.evaluate(() => { const r = document.querySelector('#rich'); r.textContent = ''; r.focus(); });
    await page.keyboard.type('Before ', { delay: 10 });
    await page.keyboard.type('::gap', { delay: 15 });
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.equal((await value('#rich')).trim(), 'Before', 'going back in a rich editor takes the trigger out and inserts nothing');
    console.log('OK Rich editor: the text replaces the trigger after the warning; going back inserts nothing');

    // 5. Don't warn me again: saved through the worker, said on the card.
    await typeIn('#editor', '::gap');
    await page.check('#ff-unf .ff-unf-mute input');
    await page.click('#ff-unf .ff-unf-secondary');
    await page.waitForSelector('#sb-celebrate .sb-cel-note');
    const muteMsg = await page.evaluate(() => window.sent.filter((m) => m.type === 'snippet_check_unfinished'));
    assert.deepEqual(muteMsg, [{ type: 'snippet_check_unfinished', id: 'gap', on: false }]);
    assert.match(await page.$eval('#sb-celebrate .sb-cel-note', (n) => n.textContent), /won’t warn you again/);
    await shot('2-muted-note');
    await settle();
    console.log('OK Mute is saved and the card says so');

    // 6. A save that fails is said too, and the text still goes in.
    await page.evaluate(() => { window.answerMute = false; });
    await typeIn('#editor', '::gap');
    await page.check('#ff-unf .ff-unf-mute input');
    await page.click('#ff-unf .ff-unf-secondary');
    await page.waitForSelector('#sb-celebrate .sb-cel-note');
    assert.match(await page.$eval('#sb-celebrate .sb-cel-note', (n) => n.textContent), /Couldn’t save that/);
    await settle();
    assert.equal(await value('#editor'), 'Hello [xxx], your order is ready.');
    console.log('OK A failed mute is reported, never silent');

    // 7. A snippet someone muted is not checked.
    await typeIn('#editor', '::quiet');
    assert.equal(await dialogOpen(), false, 'a muted snippet opens no warning');
    await settle();
    console.log('OK A muted snippet goes straight through');

    // 8. A form: an empty box is named, Fix it goes back to it.
    await typeIn('#editor', '::form');
    await page.waitForSelector('#sb-overlay');
    await page.waitForTimeout(100);
    await page.fill('#sb-overlay .sb-inp[data-key="Client"]', 'Ada');
    await page.click('#sb-overlay .sb-insert');
    assert.equal(await dialogOpen(), true, 'Insert with an empty box warns');
    assert.deepEqual(await page.$$eval('#ff-unf .ff-unf-piece', (n) => n.map((x) => x.textContent)), ['Phone']);
    assert.equal(await page.$eval('#ff-unf .ff-unf-primary', (b) => b.textContent), 'Fix it');
    await shot('3-warning-form');
    await page.click('#ff-unf .ff-unf-primary');
    assert.equal(await dialogOpen(), false);
    assert.ok(await page.evaluate(() => !!document.getElementById('sb-overlay')), 'Fix it keeps the form open');
    assert.equal(await page.$eval('#sb-overlay .ff-field[data-ff-key="Phone"] .ff-warn', (n) => n.textContent), 'Left empty');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-key')), 'Phone', 'the caret goes to the empty box');
    await shot('4-fix-it');
    await page.keyboard.type('555 0100');
    await page.waitForTimeout(50);
    assert.equal(await page.$('#sb-overlay .ff-field[data-ff-key="Phone"] .ff-warn'), null, 'the mark goes once the box is changed');
    // Insert ignores a second press within 400ms (touch and click both fire).
    await page.waitForTimeout(450);
    await page.click('#sb-overlay .sb-insert');
    assert.equal(await dialogOpen(), false, 'a filled form inserts with no warning');
    await settle();
    assert.equal(await value('#editor'), 'Dear Ada,\nPhone: 555 0100\nThanks.');
    console.log('OK Form: the empty box is named, Fix it finds it, filled it inserts');

    // 9. Phone width: the window fits and its buttons stack.
    await page.setViewportSize({ width: 375, height: 740 });
    await typeIn('#editor', '::gap');
    const box = await page.$eval('#ff-unf', (n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; });
    assert.ok(box.left >= 0 && box.right <= 375, 'the window fits a phone screen');
    await shot('5-phone-width');
    await page.keyboard.press('Escape');
    console.log('OK Fits a phone-width screen');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('OK Unfinished-text warning in the page passed');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

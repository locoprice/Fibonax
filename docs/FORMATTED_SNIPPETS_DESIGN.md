# Formatted snippets: build plan

**Status**: step 1 (database and engine) built; steps 2 to 5 to come.
**Goal**: a snippet can carry a formatted layout (colours, tables, bold, lists, an image), filled by the same fill form and Fill from link as today, and land in Gmail looking exactly like the layout. The first real case is the LeibTour booking confirmation card, sent many times a day.
**Scope decision (Valentina, 2026-10-27)**: snippets only. Prompts and Brains stay plain text. This is the exception the Tripartite Parity rule asks to be approved; name it in every summary.
**Pro (Valentina, 2026-10-27)**: using an HTML email or an HTML file as a snippet's layout is the Pro feature. Plain snippets stay free.

---

## 0. What is already proven

Tested on 2026-10-26 in Valentina's Chrome, on a new Gmail message, with her real template and sample values:

- A `paste` event carrying `text/html` (and `text/plain`) is accepted by Gmail. The card went in unchanged: 12 tables, every inline style, emoji, logo. The draft Gmail saved held the same HTML, so the recipient sees the same card.
- `document.execCommand('insertHTML')` is refused: Gmail enforces Trusted Types. Never use it, or `innerHTML`, on a host page.
- The paste route is the one Fibonax already uses for multi-line bodies (`_cePasteInsert` in `extension/content/content.js`). Adding `text/html` to the same `DataTransfer` is the whole change on the insert side.

---

## 1. What the user does

1. In the snippet editor, choose **Use a formatted layout**, then paste the layout (copied from Gmail, a document or a web page) or open an `.html` file. Fibonax keeps the formatting.
2. Click a sample value in the layout (`Mario Rossi`, `2`, `Fri, 03-04-2026`, `€326.00`) and choose **Make it a field**. The usual Text, Number, Date/Time or Choice window opens, with Fill from a pasted link available as today. The sample value becomes the field.
3. Calculations (nights between two dates, a total) are added with the Math window, exactly as today.
4. Save. Expanding the snippet opens the same fill form. Insert puts the filled card into Gmail.
5. Where formatting cannot go (WhatsApp, plain text boxes, Share on the phone) the same snippet prints as plain text.

**Remove layout** turns the snippet back into plain text, with Undo. Old snippets are untouched.

---

## 2. How it is built

### 2.1 One rule that keeps everything else working

**The plain body stays the source of the form; the layout is a second rendering of the same tokens.**

- `snippets.body` / `bodies` keep holding plain text with tokens, derived from the layout at every save (text of the layout, tokens kept, line breaks from blocks and `<br>`).
- New nullable `snippets.body_html` (active language mirror) and `bodies_html jsonb default '{}'` (per language, same shape as `bodies`) hold the layout with the same tokens as literal text.
- Every token in the layout appears, in the same order, in the plain body. A save that breaks this is refused with a plain message. `fillForm` keeps deciding fields, defaults, errors and Fill from link from the plain body, so the form, the four renderers' field code and `extension/shared/fill-form.js`'s decisions do not change.

Consequences that come for free:

- Old extension versions, search, `ask-sprintbrain`, `draft-with-ai`, Notion push and the snippet list keep reading plain `body`.
- `accessible_snippets()` returns `SETOF snippets`, so the new columns reach mobile without a change to the function.

### 2.2 Database (`services/supabase/migrations/`)

- Add `body_html text null`, `bodies_html jsonb not null default '{}'` to `snippets` and to `snippet_revisions`.
- `save_snippet_with_revision`: new optional `p_body_html`, `p_bodies_html`. Both left out keeps the saved layout, so a dashboard tab opened before the change cannot wipe one; given, they are saved as a pair, and `''` with `{}` removes the layout. Each revision keeps its layout.
- Size caps: `body_html` 200 KB, `bodies_html` 1 MB.
- The review guard counts `body_html` and `bodies_html` as content: a non-approver's change to an approved snippet's layout sends it back for review.
- Free plan, no restore: additive columns only, tried first with the rolled-back trial recipe. Migration `20261027120000_formatted_snippet_layouts.sql`, undo in `services/supabase/rollbacks/`.

### 2.3 Engine (built in step 1)

- `extension/formula-engine.js` `resolveBody(body, vals, { html: true })` resolves a layout: every printed value is escaped (`sbEscapeHtml`): fields, formulas, `{time:}`, greetings, gender, saved values. `{case:}` changes the letters of the text and never a tag or an entity (`sbApplyCaseModeHtml`). Without `html` nothing changes: every plain snippet prints exactly as before.
- `extension/shared/fill-form.js`: `fillForm(body, values, { formatted: body_html })` returns `formatted`, the layout filled with the same answers, defaults and calculations as `preview`. Tokens in the layout are read back as written (entities decoded, stray tags dropped, inside `{…}` only). When the layout asks for other fields than the text (something saved the text alone), `formatted` is null and surfaces insert the plain text.
- `app/public/mobile/index.html`: the fill-form copy regenerated, the same `html` handling ported to the phone's own `resolveBody`. `scripts/check-snippets.js` pins engine and phone to the same layout output; `scripts/check-fill-form.js` pins `formatted`.
- Limits inside a layout, stated in the manual and enforced by the template validator:
  - A condition (`{if:}` … `{endif}`) opens and closes in the same table cell or paragraph.
  - Line-based clean-ups (dropping the line of an empty optional field, a `print=no` menu, button `trim`) do not apply inside a layout. The plain version keeps them.

### 2.4 Safety

- **Sanitize on save** with DOMPurify and an allowlist: table elements, `div`, `p`, `span`, `br`, `b`, `strong`, `i`, `em`, `u`, `font`, `ul`, `ol`, `li`, `blockquote`, `h1` to `h6`, `hr`, `a` (http, https, mailto), `img` (https only). Attributes: `style`, `width`, `height`, `align`, `valign`, `border`, `cellspacing`, `cellpadding`, `colspan`, `rowspan`, `bgcolor`, `color`, `size`, `face`, `dir`, `alt`, `href`, `src`. Everything else is dropped: scripts, `on…` handlers, `<style>` blocks, iframes, forms, comments, classes.
- **Previews render in a sandboxed frame** (`<iframe sandbox srcdoc>`, no scripts) on the dashboard, popup and mobile. Shared-folder snippets come from other people; nothing in a layout ever runs.
- Insert only through the paste event; the host editor sanitizes again.

### 2.5 Fill surfaces

| Surface | Change |
|---|---|
| Overlay (`extension/content/content.js`) | A contenteditable host that is not Lexical gets the paste with `text/html` = `renderLayout(...)` and `text/plain` = today's `vm.preview`. Inputs, textareas and Lexical (WhatsApp) keep today's plain path. All three entry points (trigger, picker, context menu). The preview pane shows the layout in a sandboxed frame. |
| Popup (`extension/popup/popup.js`) | Copy writes a `ClipboardItem` with `text/html` and `text/plain`. Preview in a sandboxed frame. |
| Editor preview (`app/src/features/snippets/SnippetPreview.tsx`) | Layout in a sandboxed frame; Copy writes both formats. |
| Mobile (`app/public/mobile/index.html`) | Preview in a sandboxed frame at phone width; Copy writes both formats (`ClipboardItem`, with plain `writeText` as fallback); Share stays plain text. |
| Background (`extension/background/background.js`) | Add `body_html` (and `bodies_html` where `bodies` is read) to the snippet selects and the cache. |

### 2.6 Editor (`app/src/features/snippets/`)

- New `FormattedBodyEditor`: a contenteditable view of the layout, tokens shown as chips that cannot be split, typing allowed for small text edits. It offers the textarea's contract to `NewSnippetDialog.tsx`: `insertAtCursor`, `replaceRange` mapped through token order, caret context. Every builder, the Fields, Actions, Math and Logic lists, Edit, Save, Cancel, Remove and Undo then work unchanged on top of it (✏️ Edit and Remove rule).
- **Make it a field**: the selected sample text opens the chosen window with it as the default, and the selection is replaced by the token.
- Paste box reads `text/html` from the paste event, sanitizes, and falls back to plain text when the clipboard carries none. **Open an .html file** reads the file in the browser (nothing is uploaded) and goes through the same cleaner.
- The plain body is derived from the cleaned layout at every save, keeping the tokens (`layoutToPlain`, beside the sanitizer in `app/src/lib/`).
- Behind a Pro switch in `app/src/lib/proFeatures.ts`, with the phone and manual kept in step by `scripts/check-pro-gate.js`.
- Language pills switch `bodies_html` slots exactly as they switch `bodies`.
- Version history (`VersionHistoryPanel.tsx`) shows and restores the layout. Duplicate copies it. JSON export and import (`app/src/lib/snippetIo.ts`) carry `body_html` / `bodies_html`; Text Blaze import is unchanged.
- Data path: `app/src/types/database.ts`, `app/src/lib/api/snippetsApi.ts` (`SNIPPET_SELECT`, save, duplicate), `app/src/lib/api/revisionsApi.ts`, `app/src/stores/snippetStore.ts`.

---

### 2.7 Already built by pictures (v3.94.0)

Pictures in snippets (`{picture:}`, `docs/pro-features/snippet-pictures.mdx`) needed the same insert and Copy paths, so they exist now: `fillForm` returns `formatted` for a plain text with pictures too, and `parts` for previews; the overlay pastes `text/html` into editors that take it (`_takesFormatting`, not Lexical) on all three entry points, and Undo removes the inserted pictures (`_ceRemovePictures`); the popup, the editor preview and the phone copy both formats. Steps 3 and 4 reuse them for layouts. The formatting toolbar (Bold, Italic, Underline, lists) was approved on 2026-10-27 as part of step 2: free, shown as it will look.

### 2.8 The formatting bar (v3.95.0)

Built ahead of pasted layouts, on the same columns (migration live since 2026-10-27):

- `app/src/features/snippets/FormattedBodyBox.tsx` replaces the body textarea for every snippet: a contenteditable with the bar, fields as chips, keeping the textarea's contract (`value`, `selectionStart`, `setSelectionRange`, `focus`) so every builder, list, Remove and Undo works unchanged.
- `app/src/lib/formattedBody.ts` is the model: one block per plain line, list lines carrying "• " / "N. " in the plain body, `docToHtml` for the layout (`<div>` lines, `<ul>`/`<ol>`, `<b>`/`<i>`/`<u>`, fields as text), `syncDoc` bringing a change made outside the box in while keeping the formatting around it. A body with no formatting saves no layout.
- Saved: `bodies_html` per language beside `bodies`, `body_html` its mirror; the save function gets the pair. Version history, duplicate, JSON export and import carry it (import rebuilds it through the model).
- Surfaces pass `formatted: body_html` (extension caches `bodyHtml` / `bodiesHtml`; the phone reads `body_html` per language). Previews draw it with `layoutFragment` in `extension/shared/fill-form.js`, rebuilt node by node, so nothing in a layout runs. Undo after a formatted insert also takes out the lines and lists it left empty.
- Pasting into the box takes text only. Formatting copied from elsewhere stays the Pro layout feature (steps 2 to 5 above).
- **Text colour** (v3.97.0, free like the rest of the bar): an "A" button after Underline opens Default and nine colours (`app/src/features/snippets/TextColorButton.tsx`, palette in `app/src/lib/textColors.ts` and `docs/DESIGN_SYSTEM.md`). A run carries a palette key; `docToHtml` writes `<span style="color:#…">` around the marks, and `docFromNode` keeps only palette colours, by either shade, so anything else in a layout is dropped. Selected text is coloured through the model; with nothing selected, the browser's own typing colour is used and the box redraws its `<font>` at once. `layoutFragment` keeps a `color` written as `#rgb`, `#rrggbb` or `rgb()`, so every preview shows it; inserts and Copy carry the layout as it is. Plain text has no colour.

## 3. Order of work

One feature, built in five steps. Each step passes the gates and bumps the version. The editor's **Use a formatted layout** entry stays hidden until step 4 is done, so develop never offers a layout that a fill surface cannot insert (⚡ Authoring and Expansion Parity). Nothing is promoted to `main` before step 5.

1. **Database and engine.** Migration, revision RPC, review guard, `html` resolving, `formatted` in the fill form, phone parser port, gate cases. Nothing visible.
2. **Editor.** DOMPurify and the cleaner, `layoutToPlain`, paste and open an `.html` file, chips, Make it a field, lists and Undo, save, history, duplicate, export; editor preview with Copy; the Pro switch. The cleaner moved here from step 1: it runs where layouts are saved, and it needs a browser to run and to be tested.
3. **Extension.** Overlay insert in Gmail (then Outlook web), plain fallback elsewhere, Undo after a formatted insert; popup preview and Copy.
4. **Mobile.** Preview and Copy at 375px; Share plain.
5. **Manual and release.** New page `user-docs/text-snippets/formatted-layouts.mdx`, row in `docs/USER_DOCS.md`, store listing check, the entry switched on.

`_progress.md` tracks the steps across sessions.

---

## 4. Verification

- Gates per step as in the root `CLAUDE.md` (app lint, typecheck, build; extension `node --check` and the four check scripts; docs checks).
- Round-trip tests: layout → plain body (tokens equal, order equal); `formatted` escaping (`<`, `&`, quotes in a value read from a link); sanitizer (script, `onerror`, `javascript:` dropped).
- Expanded for real, not read: the booking card filled from a pasted link and inserted into a new Gmail message on the overlay's three entry points, compared against the template; the same snippet in WhatsApp Web prints plain text; Undo removes the card; popup Copy pasted into Gmail; mobile at 375px, Copy pasted into Gmail on the phone.

---

## 5. Risks

- **Undo after a formatted insert.** The Undo card measures inserted text; a removed card may leave empty table cells behind. Step 3 must prove Undo, or change how a formatted insert is undone.
- **Other editors.** Outlook web and helpdesk editors handle a pasted layout their own way. Gmail is the target; others are tested and named in the manual.
- **Gmail on the phone** may simplify the two-column rows.
- **Images** are linked, not hosted by Fibonax. A layout whose image address stops working shows a broken image.
- **The mobile file** has no `.gitattributes`: check `git diff --numstat` before each commit.

---

## 6. Decisions

1. **Sanitizer: DOMPurify** (approved by Valentina, 2026-10-27). A new dependency in `app/` only, configured with the allowlist in 2.4, run where layouts are saved. The extension and mobile add no library: they render layouts inside sandboxed frames and insert through paste.
2. **Pro** (Valentina, 2026-10-27): using an HTML email or an HTML file as a layout.
3. **Open: switched on or locked.** Every Pro feature today ships locked for everyone, the owners included, until the Pro plan exists (`docs/pro-features/README.md`). The other Pro features are locked because each use costs AI credit; a layout costs nothing to run. To decide before step 2: ship this switch on (everyone can use it now, the plan check added when the plan exists) or locked.

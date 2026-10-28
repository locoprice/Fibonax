# Fibonax — Design System v1.1 (Canonical)

> **On-demand reference.** Pulled out of the root `CLAUDE.md` to keep always-on context lean. **Read this file before any UI, CSS, component, or token change** — it is the single source of truth for visual decisions.

**Status**: Active (shipped 2026-05-18). Replaces the dual Iris/Azure split from v1.0 with a single Azure primary across every surface (landing, mobile, dashboard, extension popup, in-page overlay).

## Visual source of truth

`design_handoff_design_system/mockups/harmonized-final.html` is the **single visual reference** for every UI decision. Open it in a browser before designing or reviewing any UI change. Every surface in the file — tokens strip, landing, mobile (home + detail + sheet), dashboard, extension popup — is the rendering target.

When the mockup and a piece of shipped UI disagree, the mockup wins by default. Disagreement that is intentional (e.g. a follow-up ticket altering the design) must be tracked explicitly with a follow-up entry below.

## Canonical tokens

> **Hard rule**: Any new color, radius, shadow, or spacing value introduced in any package must be added to this table **first**, then referenced by name from the appropriate token file:
>  - Dashboard: `app/tailwind.config.ts` + `app/src/index.css` (CSS variables)
>  - Extension + overlay: `extension/shared/tokens/colors_and_type.css`
>  - Mobile companion: inline `:root` in `app/public/mobile/index.html` (kept in sync with this table)
>
> Hard-coded hex values in component files are forbidden outside three documented exceptions: the per-language inline tints in `SnippetsTable.tsx` (which intentionally mirror the mobile palette), and the **dark prompt-editor vocabulary** in `PromptBlockEditor.tsx`, an untokenized side-panel palette that predates this table. Components rendered *inside* that panel (`LabelPicker`'s `dark` tone) may reuse those exact hexes; they may not invent new ones. Tokenizing the panel is an open follow-up. The third exception is the four colours of Google's "G" mark in `components/auth/GoogleSignIn.tsx`: Google's branding guidelines fix them, so they are never tokenized or recoloured. The button around it uses the standard `ghost` variant.

### Neutrals

| Token        | Hex       | Usage                                        |
| ------------ | --------- | -------------------------------------------- |
| `bg`         | `#FAFAFA` | Page background (dashboard)                  |
| `bg-alt`     | `#F2F2F7` | Sidebar background (dashboard); muted card   |
| `card`       | `#FFFFFF` | Card / surface (all)                         |
| `line`       | `#E5E5EA` | Hairline border                              |
| `ink`        | `#1C1C1E` | Primary text                                 |
| `ink-muted`  | `#6E6E73` | Secondary text                               |
| `ink-subtle` | `#6B6B70` | Tertiary text / hints (WCAG AA ≥4.5:1 on `card` / `bg` / `bg-alt`) |

### Mobile Concept B: light page, navy home band (2026-10-23)

Valentina chose the light Concept B mockup (`concept-b.html`, "B + A, Selected
direction") on 2026-10-23, replacing the dark palette applied earlier that day.
The page is light; only the home screen's top band is navy. Azure stays the one
action color. These values apply only to `/mobile/`.

| Mobile token | Hex | Usage |
| --- | --- | --- |
| `mobile-bg` | `#F8F9FC` | Page canvas |
| `mobile-bg-alt` | `#F2F2F7` | Muted raised surfaces |
| `mobile-card` | `#FFFFFF` | Cards, menus and input surfaces |
| `mobile-line` | `#D7DCE8` | Borders and dividers |
| `mobile-ink` | `#1C1C1E` | Primary text |
| `mobile-muted` | `#596478` | Secondary text |
| `mobile-subtle` | `#6B6B70` | Tertiary text and hints |
| `mobile-primary-copy` | `#1B4FD8` | Azure text and icons |
| `mobile-primary-border` | `#1B4FD8` | Focus rings and selected outlines |
| `mobile-primary-bg` | `#EEF2FF` | Tinted Azure wells, chips and pinned cards |
| `mobile-navy` | `#101C39` | Home band background |
| `mobile-navy-soft` | `#203151` | Task cards on the home band |
| `mobile-navy-line` | `#6B7C9C` | Task card borders on the home band |
| `mobile-navy-copy` | `#C1CBE0` | Secondary text on the home band |
| `mobile-warning` | `#D97706` | Warning text and indicators |
| `mobile-warning-bg` | `#FFFBEB` | Warning surfaces |
| `mobile-danger` | `#B42318` | Error text and indicators |
| `mobile-danger-bg` | `#FEF2F2` | Error surfaces |

The home screen follows the mockup, made quieter at Valentina's request: the
band carries the wordmark, the account picture (initials when there is none), **What's next?**
and three equal white buttons (**Use a snippet**, **Prepare a prompt**,
**Capture a note**), each with an icon tile, a line saying what it does and a
blue arrow. They sit on a raised edge and sink 3px when pressed, so each one
reads as its own button (users missed that the two plain links under a single
card led to other sections). Side by side from 700px. The mockup's workspace line and two-line intro are left
out; the company shows in the footer logo. The app version and the month of the last update sit in the band under **Capture a note**, as one centred line of plain mono text (`v3.82.0 · Updated Oct 2026`, no pill). Below the band: **Ready to reuse**
with the first pinned snippet and prompt as cards, **Search snippets** and
**Your Brains**. The bottom bar is white, and the active tab is Azure with a
short bar under it.

### Primary (single — Azure)

| Token          | Hex                    | Usage                                  |
| -------------- | ---------------------- | -------------------------------------- |
| `primary`      | `#1B4FD8`              | Brand + accent across every surface    |
| `primary-dark` | `#1440B0`              | Hover / pressed                        |
| `primary-light`| `#3D6FE8`              | Hover bg gradient endpoints            |
| `primary-bg`   | `#EEF2FF`              | Filled-tint badge / active row bg      |
| `primary-bdr`  | `#BED0FF`              | Filled-tint badge border               |
| `primary-glow` | `rgba(27,79,216,.14)`  | Focus ring shadow                      |

**v1.1 removes Iris purple `#6C5CE7` entirely.** The `--sb-iris*` aliases in the extension's tokens file still resolve, but they all point at the azure values. Any new code must use `--sb-azure*` / `primary` directly.

### Language palette (must stay identical across all surfaces)

| Lang  | Fg        | Bg        |
| ----- | --------- | --------- |
| EN    | `#1B4FD8` | `#EEF2FF` |
| ES    | `#C2410C` | `#FFF7ED` |
| IT    | `#15803D` | `#F0FDF4` |
| FR    | `#0D9488` | `#F0FDFA` |
| MULTI | `#7C3AED` | `#F5F3FF` |

**FR is a first-class language (re-added v2.88.0)** with its own teal palette — distinct from EN, IT, ES, and MULTI so every language pill stays visually unambiguous. It appears in the create/edit language picker; the `Snippet['language']` union already carries it.

**v1.1 changed IT from red `#DC2626` to green `#15803D`** to remove the false signal that Italian = stop / error.

### Label palette (LABELS-001)

The eight colors a user can pick for a label. Labels are one vocabulary shared by snippets and prompts, so the palette is a **closed set** — the DB stores the key (`labels.color`), never a hex, and each surface resolves it. Same contract as `folders.ico`. The dashboard resolver is `app/src/lib/labelColors.ts`; that module is the only place these values may appear.

| Key      | Fg        | Bg        | Border    | Origin                                       |
| -------- | --------- | --------- | --------- | -------------------------------------------- |
| `azure`  | `#1B4FD8` | `#EEF2FF` | `#BED0FF` | `primary` / `primary-bg` / `primary-bdr`     |
| `violet` | `#7C3AED` | `#F5F3FF` | `#DDD6FE` | MULTI language · ToT strategy chip           |
| `green`  | `#15803D` | `#F0FDF4` | `#BBF7D0` | IT language · Few-shot strategy chip         |
| `orange` | `#C2410C` | `#FFF7ED` | `#FED7AA` | ES language · One-shot strategy chip         |
| `teal`   | `#0F766E` | `#F0FDFA` | `#99F6E4` | FR ground, at the **darkened** fg (see below) |
| `rose`   | `#BE123C` | `#FFF1F2` | `#FECDD3` | RAG strategy chip                            |
| `amber`  | `#D97706` | `#FFFBEB` | `#FDE68A` | `warning-deep` on `warning-bg`               |
| `slate`  | `#475569` | `#F1F5F9` | `#CBD5E1` | New neutral — the "no strong signal" label    |

**Label teal is `#0F766E`, not the FR token's `#0D9488`.** A label badge is text, and `#0D9488` on its tint is ~3.6:1 — it passes the 3:1 UI threshold but misses 4.5:1 for text. `#0F766E` is ≈5.3:1 and is the exact value the open "FR contrast darken" follow-up below targets, so the two converge rather than fork.

Badges keep their light tints in dark mode, matching every shipped chip on the dashboard (language pills, strategy chips, `Badge variant="primary"`).

**Sub-labels (LABELS-002).** A label may nest one level under another (`labels.parent_id`, max depth 2 — see `app/src/lib/labelTree.ts`). Nesting is rendered as a **14 px indent per level**, the same step the folder rail uses, in the label manager, the picker, and the filter menu. No new tokens: a sub-label draws from the same eight-key palette, and a new child defaults to its parent's key so a family reads as one group. The chip itself always shows the **bare child name** — a table row has no room for a path — with the full `Parent / Child` on hover. Selecting a parent in the filter also matches its children, matching how selecting a parent folder lists its subtree.

### Text colour palette (snippet body)

The nine colours of the Text colour menu in the snippet body's formatting bar, in Notion's order after **Default**. A closed set: the editor keeps the key, and the layout an email gets carries the email hex inline (`<span style="color:#…">`), because email clients drop classes and stylesheets. The body box and the editor preview show the dark shade on the dark theme. The dashboard resolver is `app/src/lib/textColors.ts`, the only place in `app/` these values may appear. The extension and the phone draw whatever colour a layout carries and need no copy of the palette.

| Key      | Name   | Email (light) | Dark theme | Origin |
| -------- | ------ | ------------- | ---------- | ------ |
| `grey`   | Grey   | `#6E6E73` | `#AEAEB2` | `ink-muted`, light and dark |
| `brown`  | Brown  | `#8B5E3C` | `#C8A07E` | New |
| `orange` | Orange | `#C2410C` | `#FB923C` | ES language / label orange |
| `yellow` | Yellow | `#A16207` | `#FACC15` | New: `warning-deep` misses 4.5:1 as text on white |
| `green`  | Green  | `#15803D` | `#4ADE80` | IT language / label green |
| `blue`   | Blue   | `#1B4FD8` | `#6E96F0` | `primary`; dark is `--activity-4` |
| `purple` | Purple | `#7C3AED` | `#C084FC` | MULTI language / label violet |
| `pink`   | Pink   | `#BE185D` | `#F472B6` | New |
| `red`    | Red    | `#D70015` | `#F87171` | `danger` |

Every email value holds 4.5:1 on white and every dark value 4.5:1 on the dark `card` (`#2C2C2E`). In the menu each row is an "A" in its colour beside the colour's name, and the button names the colour in use ("Text colour: Red"), so a colour is never told by its shade alone.

### Prompt strategy chips

One label per prompt, shown on the dashboard prompt cards, the `/mobile/` prompt list and the extension popup. It replaced the separate one-shot / few-shot type badge when the editor's Type box was removed, since Strategy already carries both.

| Strategy | Fg        | Bg        | Extension token                                  |
| -------- | --------- | --------- | ------------------------------------------------ |
| CoT      | `#1B4FD8` | `#EEF2FF` | `--sb-azure` / `--sb-azure-bg`                   |
| ToT      | `#7C3AED` | `#F5F3FF` | `--sb-lang-multi` / `--sb-lang-multi-bg`         |
| Few-shot | `#15803D` | `#F0FDF4` | `--sb-lang-it` / `--sb-lang-it-bg`               |
| One-shot | `#C2410C` | `#FFF7ED` | `--sb-lang-es` / `--sb-lang-es-bg`               |
| RAG      | `#BE123C` | `#FFF1F2` | `--sb-strat-rag` / `--sb-strat-rag-bg`           |
| Agentic  | `#F5F5F5` | `#0A0A0B` | `--sb-strat-agentic` / `--sb-strat-agentic-bg`   |

No strategy set means no chip.

### Semantic

| Token          | Hex       | Usage              |
| -------------- | --------- | ------------------ |
| `success`      | `#34C759` | Confirmation, deltas (Apple semantic green) |
| `warning`      | `#FEBC2E` | Caution — a **fill**; too light to read as text or an icon |
| `warning-deep` | `#D97706` | Amber that holds contrast as text/icon on `warning-bg`. Mirrors `--sb-warn` |
| `warning-bg`   | `#FFFBEB` | Amber tint ground. Mirrors `--sb-warn-bg` |
| `danger`       | `#D70015` | Destructive (Apple SF system red — AA-safe as text on `card`) |
| `danger-bg`    | `#FEF2F2` | Red tint ground. Mirrors `--sb-danger-bg` |

**Known divergence:** the extension's `--sb-danger` is `#DC2626`, not the canonical `#D70015` above. It predates this table and is used by every danger element in the popup, so status badges inherit it — the wrench reads marginally warmer in the extension than in the dashboard. Aligning the token is a follow-up (below), not a per-component override: hard-coded hexes in component files stay forbidden.

### Activity heatmap scale (Analytics "Activity Overview")

Azure intensity ramp for the GitHub-style contribution graph. Replaces GitHub's green so the heatmap stays on the single azure primary. Defined as CSS variables in `app/src/index.css` (light + dark) — referenced by name, never hard-coded in components.

| Token (light → dark)   | Light       | Dark        | Usage                          |
| ---------------------- | ----------- | ----------- | ------------------------------ |
| `--activity-0`         | `#EBEDF0`   | `#2C2F36`   | No activity (empty cell)       |
| `--activity-1`         | `#C7D8FF`   | `#1E3A6E`   | Low activity                   |
| `--activity-2`         | `#8FAEF6`   | `#2C56A8`   | Moderate activity              |
| `--activity-3`         | `#4E7AEA`   | `#3F74E0`   | High activity                  |
| `--activity-4`         | `#1B4FD8`   | `#6E96F0`   | Peak activity (brand)          |
| `--activity-cell-border` | `rgba(27,31,35,.06)` | `rgba(255,255,255,.06)` | 1px inset cell hairline |

### Radii

| Token         | Value | Usage                                    |
| ------------- | ----- | ---------------------------------------- |
| `r-xs`        | 4 px  | Inner chips, code tokens                 |
| `r-sm`        | 6 px  | Small buttons, icon wells                |
| `r-in`        | 10 px | Inputs                                   |
| `r` (default) | 12 px | Cards (mobile), primary buttons          |
| `r-btn`       | 14 px | Mobile copy button (large hit target)    |
| `r-card`      | 16 px | Cards (dashboard, mockup KPI + table)    |
| `r-card-lg`   | 18 px | Mobile snippet card                      |
| `r-pill`      | 9999  | Pills, chips, count badges               |

### Landing context container (v3.41.1)

The landing groups its three layers, portable context, execution flow and audience
inside one bordered surface. It retains the canonical azure, neutral palette,
16 px card radius and small shadow. This intentionally replaces the four separate
marketing sections; the dashboard, extension and mobile app keep their own shells.

Landing spacing tokens (inline `:root` in `app/public/landing/index.html`):

| Token | Value | Use |
| --- | --- | --- |
| `space-1` | 4 px | Tight text spacing |
| `space-2` | 8 px | Inline gaps |
| `space-3` | 12 px | Text groups |
| `space-4` | 16 px | Card gaps and compact inset |
| `space-6` | 24 px | Card inset |
| `space-8` | 32 px | Container divisions |
| `space-10` | 40 px | Desktop container inset |
| `space-12` | 48 px | Section separation |
| `space-16` | 64 px | Outer section separation |

The flow wraps to two columns on phones, the layer cards stack below 760 px,
and every paragraph stays visible without tabs or accordions.

The portable-context panel uses a neutral split layout and a static node diagram,
inspired by Attio's restrained grids: canonical `card` / `bg` / `line` colors,
6 px small radius, monospaced labels, and a subtle dotted ground. The adjacent
logo grid is stationary, with hairline separators and no visible heading. It
retains the nine existing brands and adds the AWS Startups, NVIDIA Inception
and Google for Startups program marks already present in the footer. Program
names remain complete; these marks must not be relabeled as customer endorsements.
Attio informs the equal-cell structure and GitHub the balanced monochrome marks;
neither site's customer roster is imported. The grid uses four columns on desktop,
three below 960 px and two below 640 px. Cells use the existing spacing tokens,
with optically sized artwork. Airbnb, Marriott, Booking.com, Expedia, Hilton and
Tripadvisor vector marks come from the corresponding icons in the Simple Icons
repository (https://github.com/simple-icons/simple-icons/tree/develop/icons).
Program artwork reuses the local footer assets. The grid adds no JavaScript,
automatic motion, interactive affordances or keyboard stops.

### Shadows

| Token       | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| `shadow-sm` | `0 1px 3px rgba(0,0,0,.06), 0 4px 14px rgba(0,0,0,.04)`           |
| `shadow-md` | `0 4px 20px rgba(27,79,216,.12), 0 1px 3px rgba(0,0,0,.06)`       |
| `shadow-pill` | `0 1px 2px rgba(20,64,176,.35), 0 3px 8px rgba(27,79,216,.28), inset 0 1px 0 rgba(255,255,255,.28)` |

### Motion & overlay (added v2.97.0)

Registered in `extension/shared/tokens/colors_and_type.css`. The extension popup uses these; other surfaces may adopt them.

| Token           | Value                 | Usage                                          |
| --------------- | --------------------- | ---------------------------------------------- |
| `--sb-toast-bg` | `rgba(24,24,27,.92)`  | Toast pill surface (ink @ 92%) — tokenizes the old inline literal |
| `--sb-scrim`    | `rgba(0,0,0,.5)`      | Modal / auth backdrop                          |
| `--sb-dur-loop` | `1200ms`              | Skeleton shimmer, syncing-dot pulse (looping)  |
| `--sb-stagger`  | `20ms`                | Per-row list entrance delay (capped at 8 rows) |

**FR language token corrected (v2.97.0):** the extension tokens file previously aliased `--sb-lang-fr`/`--sb-lang-fr-bg` to MULTI violet; it now holds the documented teal `#0D9488` / `#F0FDFA` (matching this table and `/mobile/`). The popup and `Sprintbrain.html` `.FR` rules were repointed to the tokens. Contrast of teal on its tint is ~3.6:1 (passes 3:1 UI, misses 4.5:1 text) — a cross-surface darken to `#0F766E` (≈5.3:1) is an open follow-up; do not fork one surface.

### Status badges (STATUS-ICONS-001)

A 20 × 20 pill with a 12 × 12 stroked glyph, rendered beside an asset's name on the dashboard table, the prompt cards, and the extension popup list. Three states, and only ever one at a time — a fault always outranks a trophy:

| State    | Glyph  | Tint (dashboard)             | Meaning                                                        |
| -------- | ------ | ---------------------------- | -------------------------------------------------------------- |
| `top`    | Trophy | `primary-light` / `primary`  | Expanded ≥ 5 times **and** ≥ 25% of the library leader's count  |
| `broken` | Wrench | `danger-bg` / `danger`       | Template fails structural validation — renders wrong output     |
| `weak`   | Wrench | `warning-bg` / `warning-deep`| Prompt scoring ≤ 4/10, and not yet used enough to earn a trophy |

**Usage means expansions, counted per snippet — not per row.** Counts come from `snippet_events` via the `snippet_usage_counts()` RPC, never from `snippet_stats.uses` (that column only tracks copy-shortcut from the popup). A translated snippet is several rows sharing a base trigger and each is expanded under its own id, so both the badge and the Usage column sum across the group — `time` is 151 expansions across four variants, not four separate small numbers.

Motion is transform/opacity only, so frames stay on the compositor. Timings are identical on both surfaces — the popup mirrors them by hand in `popup.html` since it has no build step:

| Keyframe        | Duration / curve                          | When                                             |
| --------------- | ----------------------------------------- | ------------------------------------------------ |
| `status-pop`    | 260 ms · `--sb-ease-out` (overshoot)      | Entrance, once                                    |
| `status-wobble` | 2400 ms · `--sb-ease` · infinite          | Idle, `broken` + `weak` only — faults nag, trophies rest |
| `status-cheer`  | 520 ms · `--sb-ease`                      | Hover                                             |

Both surfaces drop every animation under `prefers-reduced-motion` and keep the static glyph in the same box, so nothing reflows between modes.

### Tooltip (TOOLTIP-001)

One tooltip for the whole product, matching the Avada element. The values are Avada's own, read off a live theme-fusion tooltip because the Avada documentation publishes the option list and no CSS.

| Property | Value |
| --- | --- |
| Background | `rgba(33, 33, 33, 0.97)` |
| Text | `rgb(209, 209, 210)` |
| Radius | `4 px` |
| Padding | `3 px 8 px` |
| Max width | `200 px` |
| Font size / line height | `12 px` / `1.4` |
| Text align | `center` |
| Opacity when shown | `0.9` |
| Transition | `opacity .3s linear` |
| Arrow | 5 px solid triangle in the background colour |
| z-index | `2030` |

These are deliberately **not** tokenised. They mirror an external design system, and a token would drift from it the first time the palette moves. Do not repoint them at `--ink` or `--card`.

**Placement** defaults to `top` and flips to the opposite side when that side has no room, the way every Bootstrap-derived tooltip behaves. Flipping is what keeps a hint triggered from a header off the element it describes. After flipping the box is clamped into the viewport and the arrow stays on the trigger, so a nudged box still points at the right thing.

**Two implementations, one spec:**

| Surface | Implementation |
| --- | --- |
| Dashboard (React) | `app/src/components/ui/tooltip.tsx`, `<Tooltip label="…" placement="top">`. Portalled, because every panel that hosts one scrolls and would clip it. Tracks the trigger per frame. |
| Popup | `extension/shared/tooltip.js` via `<script src>` |
| `/mobile/`, landing site | the same file, inlined between `SB_TOOLTIP` markers |

`/mobile/` is a single-file app and the landing site is a separate Netlify site rooted at `app/public/landing/`, so neither can reach `extension/` at runtime. Their copies are generated, never hand-edited:

```bash
node scripts/sync-tooltip.js
```

`node scripts/sync-tooltip.js --check` fails if a copy has drifted. Run it after any edit to `extension/shared/tooltip.js`.

**Usage.** On the vanilla surfaces nothing needs tagging: any element carrying a `title` is upgraded on hover, and the attribute is moved to `data-sb-tip` so the browser's own bubble never appears. Elements rendered later work for free, since the listeners are delegated on the document. Force a side with `data-sb-tip-pos`, opt out with `data-sb-tip-skip`. `title` is left alone on `iframe`, `svg`, `link` and `abbr`, where it is an accessibility label rather than a hint.

Keep the text short. Avada centres it inside 200 px, so a sentence or two reads well and a paragraph does not.

### Count pill (dashboard sidebar)

The number beside Snippets, Prompts, Brains, Team and Review: one component for every row, `app/src/components/layout/NavCountPill.tsx`. Shown while the count is above 0.

| Part | Value |
| --- | --- |
| Size | 20 px tall (the status badge's height), 20 px wide at least, `r-pill`, 6 px side padding |
| Type | 11 px semibold, tabular figures |
| Page in view | `primary` to `primary-dark` gradient, top to bottom, white digits, `shadow-pill` |
| Other pages | `card` fill, 1 px inset `line` ring, `ink-subtle` digits. While the row is hovered: `primary` digits and a `primary` ring at 40% |
| Digits | Each digit is a strip of 0 to 9 that slides in a 14 px window: 600 ms, `cubic-bezier(.22,1,.36,1)`, each digit 45 ms after the one on its left. A number rolls up from 0 when its pill first appears, and slides again on every change |
| Entrance | `fade-in`, 200 ms |
| Light sweep | One pass of a soft white band over the pill, 800 ms, starting 350 ms after the row becomes the page in view (`count-sheen`) |
| Reduced motion | No roll, no sweep, no entrance: the number shows at once, in the same box |
| Screen readers | The digits are hidden and one line of text gives the number. A pill the row name does not explain says what it counts (Team: "6 shared folders"), and that line is also the shared Tooltip on hover, placed right |

Motion is transform and opacity only, like the status badges.

## Surface-specific rules (v1.1)

- **Dashboard topbar** spans the full width (60 px) above sidebar + main. Brand square (28 px, `--primary` solid) on the left.
- **Master search bar** (SEARCH-001): the one text search on the dashboard, in the topbar between the brand and the theme toggle. `r-in` (10 px), 36 px tall, `bg-alt` at rest and `--card` on focus, capped at 360 px and allowed to shrink so a long company name never pushes the right-hand cluster off a 1024 px screen. It carries a ⌘K badge at rest and a clear cross once there is text. Typing filters the page in view; Enter or ⌘K opens the aggregated panel (560 px, `r-card`, `shadow-md`, results grouped Snippets / Prompts / Memory). The panel carries one control row under the input: **type chips** (`All`, the default, then `Snippets` / `Prompts` / `Brains`). There is no separate scope switch: a `<Section> only` scope gave the same answer as that section's chip, and the header bar already filters the page (or Brain) in view. The chips narrow what has already matched; they never change the matching rules, which live once in `searchIndex.ts`. Snippets, prompts and memory carry **no search box of their own**. A second one on a page is a defect, not a feature.
- **Dashboard sidebar** active nav: `bg-primary-light` + 3 px primary left bar (painted via `::before`, reserved track so the row doesn't shift on toggle) + count pill when count > 0 (see Count pill).
- **Dashboard sidebar, collapsed** (v3.29.0): the panel control on the WORKSPACE row folds the sidebar into a 64 px icon rail (65 px with its border), cloned from DeepL's. Rows keep their size and place: the label and count pill are clipped, not removed, so no icon moves on toggle and screen readers still read the label. Each icon names itself in a right-side tooltip, the company watermark hides, and the account menu keeps its open width over the canvas. The switch is instant and remembered per browser. It replaces the v3.8.0 hide and the v3.13.0 edge peek.
- **Mobile library pages** (Snippets, Prompts, Brains; v3.91.0) are single-scroll canvases on the home band's template: navy band (`mobile-navy`, greeting + account button, page name with its count pill, translucent search field with the **Filters** pill beside it, the filter panel dropping out of the band as a light card) → floating quick-action bar (overlaps the band by `-26 px`) → section heading → cards (`r-card-lg`, 14 px padding, `mobile-line` hairline, `primary-bg` tint while pressed, lift on hover, visible focus ring) → floating tab bar. The blue gradient hero (`#1B4FD8 → #1440B0`) that these pages carried until v3.90.0 is retired.
- **Extension popup** active folder: light-primary bg + 2 px primary left bar + **filled** azure count pill (not tinted). All Iris purples replaced with `#1B4FD8`.
- **Shortcut tag** (dashboard): the trigger and shortcut render as two separate chips — a muted trigger chip (`bg-bg-alt` / `ink-muted`) beside the shortcut chip (`bg-primary-light` / `primary`). Supersedes the single-pill `.sctag` (prefix at `0.45` opacity); the extension popup + mobile still use the inline form pending alignment.
- **Team page cover** (v2.111.0): a Notion-style full-bleed header (`-mx-8 -mt-8`, 210 px) with the org identity card (68 px, `--card` + `shadow-sm`) overlapping its lower edge. One value per organization (`organizations.cover`), chosen by an admin, visible to all members. The value is either a **preset key** — decorative gradient artwork defined in `app/src/index.css` as `.team-cover-<key>` (`azure` / `dusk` / `sea` / `sand` / `night` / `paper`), centralized like the activity-heatmap ramp, **not** design tokens — or the https URL of an uploaded image (`team-covers` bucket, admin-gated writes, 2 MB). Admins get hover controls + a gallery picker; non-admins see it read-only.

## Visual references

### Snippets identity icon (approved 2026-10-16)

Snippets use the same outlined text-selection glyph across the landing,
dashboard, mobile companion, extension and documentation. This replaces the
older lightning, document and text-type symbols used as Snippets category icons
in the historical mockup. The approved glyph uses a `0 0 24 24` viewBox, no fill,
`currentColor`, a 1.8 stroke, and round caps and joins. Its path is:

```text
M7 3H5a2 2 0 0 0-2 2v2m14-4h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h10M7 12h10M7 16h6
```

Reuse `SnippetIcon` in React and the shared Snippets SVG value within each
standalone surface. Keep each context's existing size, color and selected state;
do not override the glyph's stroke weight. Decorative instances are hidden from
assistive technology and are not keyboard stops. Preserve actual trigger text,
action icons, user-selected folder icons and intentionally icon-free lists.
All three category glyphs now share the approved 1.8 stroke weight.
Archived screenshots remain historical product captures, not icon definitions.

### Prompts identity icon (approved 2026-10-17)

Prompts use the approved landing command-window glyph (option A). Its closed,
rounded rectangular frame complements the open frame of Snippets. Reuse
`PromptIcon` in React and the matching inline SVG on standalone surfaces:
`viewBox="0 0 24 24"`, no fill, currentColor, 1.8 stroke, round caps and joins.

```svg
<rect x="3" y="4" width="18" height="16" rx="3"/>
<path d="m7 9 3 3-3 3m6 0h4"/>
```

Use it for Prompts navigation, category headings, filters and empty states.
Preserve the existing contextual size, color and selected state. Hide decorative
instances from assistive technology. Keep user-selected folder icons, functional
AI/action symbols and configurable trigger text; unfiled mobile prompts use the
Prompts glyph. Archived raster captures remain historical references.

### Brains identity icon (approved 2026-10-17)

Brains use the three outlined layers from the landing. Reuse `BrainIcon` in
React and `BRAIN_SVG` on mobile. The glyph has a 0 0 24 24 viewBox, no fill,
currentColor, a 1.8 stroke, and round caps and joins:

```text
m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5
```

The stored default key `brain` resolves to this glyph on desktop and mobile;
no stored data or icon keys change. Preserve alternative user-selected space
icons and functional action/status symbols. Category navigation, sources,
review rows, empty states and the default Brain cards use this identity.
Decorative SVGs are hidden from assistive technology and not focusable.
The extension popup Brains tab uses the same layers glyph. Icon-free Context controls remain icon-free.

### Landing pricing page (v3.99.0)

`scripts/templates/pricing.html` carries, below the hero's 3D T mark and the four principle lines (unchanged, see `scripts/templates/pricing-artwork.md`): an exchange-rate card (`card`, `border` with a 4 px `primary` top edge, `r`, `shadow-md`; the rate in `sb-mono`, the euro value in `primary` at display size; a `primary-lt` **Variable rate** chip, the date the rate was set, and a note that a new rate applies to new packs only; the paid currency is called **FiboToken** everywhere a person reads it, `FiboTokens` in the English and Spanish plural, `FiboToken` in Italian, and `credit` survives only in code), a Founding Members panel with the countdown, three plan cards (Free; Pay as you go, a one-time purchase with a `primary-lt` **Never expire** flag beside the price and its €25 / €50 / €100 packs as `bg-alt` rows with `primary-lt` bonus chips; Monthly subscription, unlimited use), the comparison table folded behind a Compare plans button (`aria-expanded`; open without JavaScript, and opened by the third card's button or the `#compare` address), How credits work, the paying FAQ, a closing panel that repeats the countdown, and a Terms and contact dialog. Every number (daily allowance, FiboToken value, top-up, FiboTokens per use, deadline) is the `PRICING` object at the end of the template; the markup repeats them in `data-pricing` slots so the page reads without JavaScript, and `scripts/check-pricing-config.js` fails CI when they disagree.

Tokens only, with one family borrowed: the Founding panels use the mobile home band's navy (`mobile-navy` `#101C39`, `mobile-navy-soft` `#203151`, `mobile-navy-line` `#6B7C9C` and the band copy `#C1CBE0`, declared as `--navy*` on `body.pricing-layout`), with two decorative `primary` glows. Cards are `card`, `border`, `r`, `shadow-sm`; the recommended Pay as you go card takes `primary` as its border, `shadow-md` and a filled `primary` pill. The comparison table shows columns on desktop and, below 800 px, one card per row with each cell labelled from `data-label`. The dialog is `card` on the shared contact backdrop values, two `aria-selected` tabs in a `bg-alt` pill, Escape closes and focus returns to the opener. The countdown is the homepage's (`#prompt-access`) in the pricing tokens: `Europe/Madrid`, one second after the deadline both panels swap to their `data-closed` wording, read from the clock on every tick and never stored.

### Landing platforms and security (v3.49.0)

The approved landing composition merges the three platform cards and security section into four tabs: Chrome Extension, Web Dashboard, Mobile Website, and Security. It retains the existing copy and azure palette. `#platforms` scopes the styling; the blue, ink, muted text and paper aliases inherit the landing's `--primary`, `--text`, `--text2` and `--card`. The section registers `--sb-line: #dde2ef`, `--sb-bg: #f7f8fc` and `--sb-radius: 24px`. The pale azure gradients, translucent backplates and cube shading are decorative artwork, local to this marketing composition. They do not introduce new product status colours.

The screenshot stage uses CSS perspective, floating layers and pointer tilt, with no 3D runtime. The Mobile Website tab has a dedicated vector scene inspired by the technical wireframes in Bending Spoons and Scale: the same pale azure background as the other tabs, projected orbital geometry, snippet-to-browser data paths and the actual product capture framed in a detailed device. The geometry stays sharp at any resolution; the screenshot retains its original pixel resolution. The azure highlights and metallic device shading are decorative artwork scoped to `.sb-mobile-scene`.

Transforms and opacity drive the device and layers; four lightweight SVG stroke paths animate their dash offsets. All loops share `--sb-animation-state`, pausing outside the viewport, in a hidden document, or through the 44 px pause control. Manual pause freezes their current positions. Reduced-motion preferences disable motion. Tabs support Left/Right, Home/End, visible focus and a labelled panel. Below 590 px the four tabs stay visible above stacked copy and artwork. Without JavaScript, the original platform and security text remains readable.

The four local, content-hashed image assets live in `app/public/landing/assets/platforms/`. Chrome Extension and Web Dashboard use real Fibonax captures from the official Chrome Web Store gallery; Security uses a capture of the existing Fibonax security section. Mobile Website uses the original 1080 × 2316 JPEG supplied by the user, displayed in full with `object-fit: contain`, without resampling or altering its contents. Each image retains its source link, intrinsic dimensions and percentage crop inside a clipping frame. Update `RELATIVE_ASSETS` in `scripts/build-landing-i18n.js` when replacing an asset, then regenerate IT/ES from the English source and locale maps.

| Surface  | Mockup section                                | Live screenshot                                                       |
| -------- | --------------------------------------------- | --------------------------------------------------------------------- |
| Mobile   | "Landing + mobile home" + "Mobile · states"   | `design_handoff_design_system/screenshots/step-a.png`                 |
| Dashboard| "Dashboard · harmonized"                      | `step-b.png` + `step-b-analytics.png`                                 |
| Extension| "Chrome extension · harmonized"               | `step-c.png`                                                          |

## Open follow-ups (intentional deviations from mockup)

- **Mobile Concept B (light, chosen 2026-10-23):** `/mobile/` uses the light
  palette and navy home band above. The home screen follows the mockup's
  layout, and since v3.91.0 the Snippets, Prompts and Brains pages share the
  same navy band (see **Mobile library pages** above); the snippet page and
  Save to Brain keep their layout in the new colors. Two mockup links point to pages mobile does not
  have yet, so they stay honest: **All pinned** is **Browse** (pinned items
  already sit at the top of the list), and **Find anything in your library** is
  **Search snippets**. Keep the pinned work, bottom navigation, company logo,
  version/update line in the Home band and Snippets/Prompts usage counts in place; Brains do
  not show usage counts.

- Mobile "Recently used" carousel: omitted from `app/public/mobile/index.html` until we track snippet `last_used_at`. Slot is reserved in the section layout.
- Mobile bottom sheet: Use now / Copy text / Pin to top / Share… / info on snippets and prompts, the same pattern on Brains and their items. Share… goes through one `shareOut()` helper: the phone's Share menu, or a copy with a toast where there is none. On a snippet with fields it opens the snippet page first, so the text is filled in before it leaves.
- Fill form typed values (v3.57.0): on all four fill surfaces (in-page overlay, including the `{{placeholder}}` box; popup detail; editor live preview; `/mobile/`) what the person types into a text or number box is **bold** (700) in the surface's full ink (`#18181B` overlay, `--sb-ink` popup, `text-ink` dashboard, `--text` mobile). The prose around the box stays muted and regular, and the placeholder stays regular, so an empty box never looks filled. Picked values keep their own look: dates (orange on mobile, azure in the overlay) and menu options (azure semibold when checked). On-screen only: inserted, copied and shared text is plain.
- Mobile Read a picture (v3.63.0): one full-width secondary row (`.cap-pic`) under the Text box in Save to Brain, the `.mbrain-act` secondary look (card background, `primary` text, `border`, `r-btn`) on two lines like the Ask row: camera icon, **Read a picture**, and a second line in `text2`. Locked for Pro it follows the Ask row: `opacity:.7`, the lock icon on the right, and the label in plain sight on the second line; under it, a `.sb-cap-note` tip (Live Text / Google Lens). While reading, the second line says **Reading the picture…** and Save waits.
- Mobile copy footer (v3.56.0): the mockup's single full-width **Copy to clipboard** became two equal buttons, **📋 Copy** (primary) and **📤 Share** (secondary: card background, `primary` text, `border`), one `.foot-btn` style on the snippet page and the Brain item page. Both turn `success` green with a tick for two seconds after they act (Copied! / Shared!). Share shows only where the browser has a Share menu (`navigator.share`); without it, Copy takes the whole row. Labels stay one line down to 320 px.
- Mobile quick-action tiles (v2.91.0; Sync tile removed v2.106.0; Brains live v3.53.0; flat since v3.91.0): full-width 3-tile bar (**Prompts · Snippets · Brains**) in one white card, a flat segmented control whose current page is the filled azure tile (`.mqa-tile.on` → `primary` fill, white icon and label); the other two are quiet `mobile-muted` tiles with a `primary-bg` hover. The 3D extruded wells of v2.91.0 are retired. The three act as a segmented current-page nav: the tile of the page in view stays filled. The bar is written once (`mountQuickActions()`) and mounted on all three pages, so it cannot drift between them. The Brains tile uses the dashboard's Brain glyph, the same Lucide icon as the sidebar's Brains entry, and the same name: the interface never says "Memory". The old Folders tile was replaced by Snippets; the cosmetic **Sync** shell (never wired to a handler) was removed.
- Mobile Brains page (v3.53.0): the prompts page shell (band, search, tiles, section heading, `.prompt-card` list, ⋮ sheet, info sheet), with an open Brain's header in the selected-folder header's slot (`.fhead`, a card since v3.91.0; on All Brains, where it holds Paste & save alone, it drops the card). Its long-Brain notice uses `warning-bg` / `warning-deep`, mirrored into the mobile `:root` as `--warn-bg` / `--warn-deep`. Paste & save (v3.54.0) is one full-width secondary `.mbrain-act` (`.is-wide`): alone in that slot on All Brains, on its own row under Copy whole Brain and Add text inside a Brain. Save to Brain is the edit modal's frame (header ✕ / title / Save, Brain select with the suggestion's one-line reason under it, Text box with "host · N words" in the count slot).
- Dashboard "Folders" nav row: mockup shows it; needs a top-level `/folders` route.
- Hero "time saved" stat: shows snippet count instead until we track time-saved telemetry.
- **Extension popup redesign (v2.97.0):** the popup became a single-column launcher (search-first, folder chips, per-language inline detail); it now ships at 540×600 (width widened from the original 480 in v2.110.0). Approved review mock at `design_handoff_design_system/mockups/popup-launcher-v2.html`. The extension section of `harmonized-final.html` and `kits/extension.html` still show the pre-redesign popup (sidebar + 32px sync bar + iris-gradient logo) — update them to this layout so the canonical mockup matches shipped UI.
- **FR contrast darken:** move FR from `#0D9488` to `#0F766E` (≈5.3:1 text) across tokens, `/mobile/`, dashboard, and popup in one change.
- **Danger token alignment:** move the extension's `--sb-danger` from `#DC2626` to the canonical `#D70015` so the two surfaces match. Touches every danger element in the popup, so it wants its own change and a visual pass — not a side effect of the ticket that surfaced it.
- **Status badges on `/mobile/`:** not rendered there yet.


### Landing Expansion Engine (October 2026)

The user-approved motion composition sits directly after the trusted-operator logos and before the feature list. It uses the existing page background and font, with a self-contained pale azure/lilac illustration palette, orbital paths, stable odometer digits and example text cards scoped to `#sb-expansion`. These decorative gradients, borders, radii and shadows preserve the approved prototype; they are not new product status tokens. The main heading and signup link remain stationary. The removed subtitle and numbered step labels must not be restored.

All displayed rates are explicitly marked as simulated, in English, Italian and Spanish. The demo reads no account analytics or private snippet content. A native pause control stops automatic metrics, examples and motion; manual expansion still works without motion. Reduced-motion preferences start the section paused, and offscreen/hidden pages suspend its timer. Locale source and generated pages remain in parity. This changes only the marketing demonstration, not the product expansion behavior or user manual.

### Unified context hero (October 2026)

The homepage combines the original hero and “Stop starting from zero” introduction in one balanced two-column container. The left column carries one h1, concise supporting copy and the existing signup CTA; the right illustrates a reusable context library and lets visitors choose an AI destination in an explicitly labeled local demo. Both columns use the same system font, canonical Azure/neutral palette, 32 px inset and equal grid tracks. The shared footer of the container carries the outcome and extension version. On narrow screens the message and CTA precede the illustration.

The illustration reuses `card`, `bg`, `bg-alt`, `primary`, `primary-lt`, `border`, `r`, `r-btn`, `shadow-sm` and `shadow-md`. Its decorative glow uses the existing primary color with transparency, without introducing product status colors. Interaction triggers one short transition, honors reduced motion and makes no network request. New styles are scoped to `.hero-context`, outside shared pricing-page fragments. The lower Expansion Engine remains unchanged. This is marketing presentation only; application behavior and user documentation are unaffected.


### Search metadata disclosure (v3.64.1)

The approved minimal snippet list omits the decorative document icon. Keep the
name, shortcut and useful status indicators visible; move the complete
label, keyword and language lists behind one **Details** button. `SearchDetails` is shared
with prompt cards for labels (Brains have no labels or alternative queries).
Labels, **Search keywords** and **Languages** have separate headings and wrap without truncation.
Languages use their full names and existing palette. Grouped desktop rows keep
their language selector inside this panel, with 44px targets and a selected ring.
Keep the visible Updated date tied to its language with compact copy such as
“Last edited on Sep 7, 2026”, followed by “English · by Alex” on a secondary line.
Show the existing resolved last editor only when known; never substitute the creator.
Keep the full timestamp and attribution in the existing tooltip. Dates shared by translations in one saved snippet
are labelled “All languages”; a partially shared update names the affected
languages. Mobile retains the language-scope wording in its information sheet;
the Jotform-inspired date and editor layout applies to the dashboard Updated column.
Single-language snippets also expose Details, even without labels or keywords.
On mobile, the information sheet lists languages; the snippet detail page keeps
the existing language selection for copying and sharing.
Hover or keyboard focus previews the panel; click/tap keeps it open. Escape,
Close details and outside click dismiss it. Only one panel is open at a time.
A matching hidden keyword or label is named in the result row. Search semantics
and stored metadata remain intact. Use the existing surface, text and focus tokens.

On phones, Details opens the existing information sheet, with full metadata,
a 44px close target and keyboard dismissal. This adapts the approved progressive
disclosure pattern to touch, following Apple popover guidance and WCAG hover/focus
requirements. The private Notion benchmark library was unavailable during review.

### Under-review indicator

`under_review` is a quiet inline clock with muted text, without a filled background or pill border. It distinguishes review state from the blue `formula` capability badge by shape as well as colour. Reuse the existing muted text tokens and 12 px clock on dashboard, mobile and extension. Labels, hints, status rules and actions remain unchanged.


### Long snippet fill forms (v3.75.0)

Owner-approved on 2026-10-20: a near-viewport overlay (1280 px maximum width,
32 px outer margin), fields left and full read-only preview right. At 800 px
and below, Fill in / Preview switches panes. Header and insertion action stay
visible, each on a soft Azure bar (`--sb-azure-bg`, as Gmail's compose window
tints its title bar) so they read apart from the white form. In-page overlay
only; the popup, dashboard preview and phone keep their own chrome. Existing Azure / neutral tokens and 44 px controls remain. Long forms
keep walk order in open, collapsible groups of four; generic numbered headings
avoid assigning an industry to a user's content. Choices collapse into a native
details disclosure retaining the existing radio/checkbox controls and Other.
Date/time adjustment is named Options. The popup adapts the split to 320 px
scroll panels; the dashboard preview can expand within its editor. Mobile has
Fill in / Preview views and an untruncated result. Shared vanilla presentation
is extension/shared/fill-form-ui.{js,css}; mobile copies are generated.


### One filter bar for Prompts and Brains (v3.77.0)

The card under the page header of Prompts and Brains is one component, `app/src/components/shared/AssetFilterBar.tsx`, with its chips, menus, Clear and Sort. Scope chips, filter menus and **Clear N filters** sit on the left; **Sort** and anything only one page has (the Brains **Trash**) sit on the right. A page fills the slots it has something for and leaves the rest out: Prompts has the folder chips and Strategy / Intent / Labels, Brains has the count and Contents / Updated. Nothing is restyled per page. The Snippets header keeps its own bar, by the owners' decision.

- Chips are pills (`rounded-full`, 32 px) with the count in a small badge; menus and quiet actions are `FilterButton` (`rounded-[10px]`, 32 px). The active state is the same `primary-light` fill on both.
- Every menu carries an icon, and a lit one names its filter and its value: **Strategy: CoT**, **Updated: Last 7 days**. The arrow keys walk a menu, Enter chooses, Esc closes it and puts focus back on its button.
- The left side wraps onto further lines when it runs out of room; the right side stays beside the first line, so Sort never drops to a row of its own and never moves when a filter is applied. Every control has a visible keyboard focus ring.
- Sort is the same three buttons as on Snippets (Name, Updated, and Usage or Items) with the same click rule (`app/src/lib/sortToggle.ts`). Pinned prompts and the default Brain stay first whichever column is chosen.
- When filters hide everything, the empty state offers **Clear filters**. The gap between the bar and the content is 16 px (`gap-4`). Dashboard only: the phone and the extension keep their own surface conventions.


### Language check in the snippet editor

When a save would edit one language and leave the others with the old text, the editor says so while the text is being changed. No new tokens.

| Part | Value |
| --- | --- |
| Language button | A 6 px `warning-deep` dot with a `card` ring replaces the blue dot on each language left behind. The button says why when pointed at, and its name carries it for screen readers: colour is never the only signal |
| Notice | In the footer beside History and Delete: `warning-bg` fill, a 1 px `warning-deep` border at 30%, 12 px `ink` text, a `warning-deep` triangle. `ink` carries the sentence because `warning-deep` on `warning-bg` is too light for text. One line, cut with an ellipsis, the full sentence on hover |
| Update link | `primary`, medium weight, for the first language that can be changed from this editor |
| Save | The first click pauses and the button reads **Save anyway**; the notice border goes to 60% and the sentence ends "Save anyway to keep it." The second click saves. The pause resets when the languages left behind change |

# User docs (docs.fibonax.com)

> On-demand reference for the 📘 User Docs rule in the root `CLAUDE.md`. Read it before changing anything a user can see, to find the page that has to change with it.

## How publishing works

- **Source:** `user-docs/` in this repository. `docs.json` holds the menu, colours, logo and redirects. Every page is an `.mdx` file.
- **Publishing:** Mintlify's GitHub app watches `locoprice/SprintBrain`, branch `main`, subdirectory `/user-docs`, and republishes the site on every push to `main`, in about a minute. Nobody clicks anything.
- **Timing:** work lands on `develop`; the docs go live at the develop to main promotion, together with the release they describe.
- **Only here:** never edit in Mintlify's web editor. Its commits would skip `develop` and the gates.
- **Domain:** docs.fibonax.com is set in the Mintlify dashboard. DNS is on Netlify: `CNAME docs` to `cname.mintlify.builders`, plus the two TXT records Mintlify asked for (`_acme-challenge.docs`, `_cf-custom-hostname.docs`).
- **History:** until 2026-09 the content lived only in Mintlify's hosted repo. Its snippet pages sat in `snippets/`, a folder name Mintlify reserves for reusable text blocks, so they were never published. The content was moved here, rewritten against v3.49.7, and the folder renamed to `text-snippets/`.

## Preview locally

```bash
cd user-docs
npx mint@4.2.940 dev
```

Open http://localhost:3000. The Mintlify CLI needs Node 20.17 or later.

## Gates

- `node scripts/check-docs.js`: menu and files match; no page in `snippets/`; internal links reach real pages, not redirects; every page has a title and a description; no long dashes; no hospitality words.
- From `user-docs/`: `npx mint@4.2.940 validate` and `npx mint@4.2.940 broken-links`.

CI runs all three on every push to `develop`.

## Page map

| Part of the product | Where it lives in the code | Page |
|---|---|---|
| Sign-up, sign-in, first snippet | `app/src/routes/{SignupPage,LoginPage}.tsx`, `app/src/components/auth/` | `quickstart` |
| Extension install, sign-in, popup, popup settings, popup footer (saint of the day, days to Christmas), the one-time note after the update from SprintBrain, the review request (popup card and dashboard banner) | `extension/popup/`, `extension/shared/saint-of-day.js`, `extension/shared/review-prompt.js`, `app/src/features/reviewPrompt/`, `extension/manifest.json`, `extension/background/background.js` (onInstalled) | `install-extension` |
| Typing triggers, the menu, fill form, right-click, Undo, capitalization | `extension/content/content.js`, `extension/background/background.js`, `extension/shared/fill-form.js` | `text-snippets/insert` |
| Snippet editor, folders, labels, list, bulk actions, unused notice | `app/src/features/snippets/`, `app/src/features/org/`, `app/src/features/labels/` | `text-snippets/create-and-organize` |
| Formatting bar and field chips in the body (Bold, Italic, Underline, Text colour, lists), and how formatted text lands | `app/src/features/snippets/FormattedBodyBox.tsx`, `app/src/features/snippets/TextColorButton.tsx`, `app/src/lib/formattedBody.ts`, `app/src/lib/textColors.ts`, `extension/shared/fill-form.js` (layoutFragment), `content.js`, `popup.js`, `app/public/mobile/index.html` | `text-snippets/create-and-organize#format-the-text` |
| Field builders: Text, Number, Date/Time, Automatic, Range, Choice, Button, and their Edit and Remove lists | `app/src/features/snippets/Form*Dialog.tsx`, `app/src/lib/form*Token.ts`, `app/src/lib/bodyItems.ts`, `app/src/lib/menuPresets.ts`, `extension/formula-engine.js` | `text-snippets/dynamic-fields` |
| Fill from link: the Actions toggle that adds a field reading a page, the tick box in each field window, the Link box on every fill form, the reading rules (`link=`), the page reader | `app/src/features/snippets/NewSnippetDialog.tsx` (Fill from a pasted link toggle under Actions), `extension/shared/fill-form.js` (readFromPage, linkUrl, LINK_TEXT), `extension/formula-engine.js` (sbParseLinkRule), `services/supabase/functions/read-link/`, `content.js`, `popup.js`, `background.js`, `SnippetPreview.tsx`, `app/public/mobile/index.html` | `text-snippets/fill-from-link` |
| Math (Price line, Calculator, Interest), Logic (Show or hide, Condition, Greeting), `{time:}`, `{case:}`, functions | `FormPriceLineDialog.tsx`, `FormCalculatorDialog.tsx`, `FormInterestDialog.tsx`, `FormConditionDialog.tsx`, `app/src/lib/formulaToken.ts`, `app/src/lib/conditionRule.ts`, `extension/formula-engine.js` | `text-snippets/formulas` |
| Check before it goes out: the unfinished-text warning (Fix it, Edit snippet, Insert / Copy / Share anyway, Don't warn me), the editor's May not be finished list and Warn me if it looks unfinished switch | `extension/shared/fill-form.js` (unfinished, UNFINISHED_TEXT), `extension/shared/fill-form-ui.js` (unfinishedDialog, flag), `content.js`, `popup.js`, `background.js` (snippet_check_unfinished), `SnippetPreview.tsx`, `NewSnippetDialog.tsx`, `app/public/mobile/index.html`, `services/supabase/migrations/20261026120000_check_unfinished.sql` | `text-snippets/insert`, `text-snippets/create-and-organize`, `apps/mobile` |
| Languages, language check, language picker, greeting and gendered words | `NewSnippetDialog.tsx`, `content.js` (language modal), `formula-engine.js` | `text-snippets/multilanguage` |
| Version history | `VersionHistoryPanel.tsx` | `text-snippets/version-history` |
| Import and export | `app/src/lib/snippetIo.ts`, `ImportExportButtons.tsx` | `text-snippets/import-export` |
| Prompt editor, blocks, Ask User Questions, Interactive Steps, details, history | `app/src/features/prompts/PromptBlockEditor.tsx`, `app/src/lib/promptUtils.ts`, `app/src/lib/interactiveSteps.ts`, `extension/shared/interactive-steps.js` | `prompts/create-prompts` |
| Prompt score | `app/src/lib/usePromptEvaluator.ts`, `PromptEfficiencyWidget.tsx` | `prompts/quality-score` |
| Prompt list, filters, cards, the `"""` menu | `app/src/routes/PromptsPage.tsx`, `PromptFilters.tsx`, `PromptCard.tsx`, `content.js` prompt picker | `prompts/overview`, `prompts/filters-and-shortcuts` |
| Brains: items, uploads, trash, history, Context button, save selection, save chat, popup Brains tab, phone (Save to Brain) | `app/src/routes/Memory*.tsx`, `app/src/features/memory/`, `extension/content/{memory-picker,save-selection,chat-capture}.js`, `extension/shared/memory-chunk.js`, `extension/popup/popup.js` (Brains tab), `app/public/mobile/index.html` | `brains/overview`, `install-extension`, `prompts/overview` |
| Review status, who approves, the Review page, what Deprecated and Archived do on each surface | `app/src/lib/reviewStatus.ts`, `app/src/components/shared/ReviewStatus{Badge,Menu}.tsx`, `app/src/features/review/ReviewQueue.tsx`, `app/src/routes/ReviewPage.tsx`, `services/supabase/migrations/20261005120000_review_status.sql`, `extension/content/content.js` (reviewWarning), `extension/popup/popup.js`, `app/public/mobile/index.html` | `review/overview`, `text-snippets/insert`, `brains/overview`, `apps/mobile` |
| Folder sharing | `app/src/features/org/FolderShareModal.tsx` | `team/sharing-and-permissions` |
| Team page, invitations, roles | `app/src/routes/{TeamPage,InvitePage}.tsx`, `app/src/features/org/` | `team/workspace` |
| Phone page, including its Brains page, Paste & save, Share beside Copy, and the Share menu entry (`manifest.webmanifest`) | `app/public/mobile/` | `apps/mobile` |
| Where the extension runs | `content.js` field detection | `integrations/supported-sites` |
| Account, branding, unused months, Santo del Giorno switch, dashboard footer (saint of the day, days to Christmas), delete account | `app/src/features/settings/{AccountPanel,BrandingPanel,InactivityPanel,SaintOfDayPanel,DeleteAccountPanel}.tsx`, `services/supabase/functions/delete-account/`, `app/src/components/layout/{SaintOfDay,ChristmasCountdown}.tsx` | `settings/account` |
| Triggers, Insert automatically | `InlineTriggerPanel.tsx`, `AutoInsertPanel.tsx`, `extension/auth/auth.js` | `settings/triggers` |
| Password, devices, login activity | `app/src/features/settings/{PasswordPanel,SecurityPanel}.tsx` | `settings/security` |
| Analytics | `app/src/routes/AnalyticsPage.tsx`, `app/src/features/analytics/`, `app/src/lib/api/analyticsApi.ts` | `settings/analytics` |
| Overviews | | `index`, `introduction`, `text-snippets/overview`, `prompts/overview` |

A new page gets a row here and an entry in the `docs.json` menu in the same change.

## Left out on purpose (checked at v3.49.7, 2026-09-27)

These exist in the product but don't work for users, so the manual stays silent about them until they're fixed. When one is fixed, document it in the same task.

- **Translate from EN** (snippet editor): the `translate-body` edge function is not deployed. Shown locked for Pro since v3.61.0.
- **Ask Fibonax** (dashboard search panel, phone) and **Draft with AI** (snippet, prompt and Brain item editors): locked for Pro since v3.61.0 ("Available to Pro users soon"). Their pages are kept, unpublished, in `docs/pro-features/`, with the lines to restore when they turn on.
- **Notion button on prompt cards**: the `notion-prompt-push` edge function is not deployed, so since v3.96.1 the button is hidden for everyone (`PROMPT_NOTION_PUSH_AVAILABLE` in `app/src/lib/notionTeam.ts`).
- **Push to Notion** (snippets): writes to one database set on the server, not to the account's own Notion. Since v3.86.1 it works only for members of the team that owns that database, and since v3.96.1 nobody else sees it (`NOTION_TEAM_ID` in `app/src/lib/notionTeam.ts`, pinned to the server's id by a test).
- **Triggers card**: the Shortcut prefix buttons and the Snippet key / Prompt key choices are saved but never read by the extension.
- **Label suggestions**: shown locked for Pro since v3.61.0 (switch `labels` in `app/src/lib/proFeatures.ts`); the `suggest-labels` function is not deployed.
- **Read a picture** (phone, Save to Brain): built locked for Pro in v3.63.0 (switch `picture`, and `PICTURE_AVAILABLE` on the phone); the `read-picture` function is not deployed. Its section is kept, unpublished, in `docs/pro-features/read-picture.mdx`. The phone page documents the free way instead: copy the text with Live Text or Google Lens, then Paste & save.
- **Add a picture** (snippet editor, Pictures section): built locked for Pro in v3.94.0 (switch `snippetPictures`); the `snippet-pictures` storage bucket is not applied. Its section is kept, unpublished, in `docs/pro-features/snippet-pictures.mdx`, to go into `text-snippets/dynamic-fields.mdx`.
- **Analytics cards**: "across 4 folders" and the "12%" change are fixed text, and "last 30 days" doesn't match the 14-day data window.

Documented as limits instead: the phone page ignores `{elseif:}` and `{else}`.

The pull from Notion (Settings > Notion sync, and the extension's sync every five minutes) was retired in v3.86.0. Its page, `integrations/notion-sync`, now redirects to `settings/account`.

# Pro features: on for Pro accounts only

Six features call the AI service, and every use costs real money. Since **v3.114.0** they are switched on, but only for a **Pro** account: anyone else sees each one where it lives, dimmed, with a lock and the tooltip **"Available to Pro users soon"**, and cannot start a request. The server checks the plan again on every call (`is_pro()`).

One switch per feature, in `app/src/lib/proFeatures.ts`. A switch says the feature is built and its server function deployed; `isProFeatureAvailable` adds the plan check (`isProPlan`, the same rule as `is_pro()`). The phone carries its own copy: `ASK_AVAILABLE` and `PICTURE_AVAILABLE`, read only through `askOn()` and `pictureOn()`, which add `isProAccount()`. `scripts/check-pro-gate.js` (CI) keeps the dashboard, the phone and the manual in step.

| Feature | Switch | Where it shows | Server function | Manual page |
|---|---|---|---|---|
| FiboChat | `ask`, **on**; `ASK_AVAILABLE` on the phone | The answer row in the dashboard search panel (and ⌘↵); the row under the search box on the phone's Snippets, Prompts and Brains pages | `ask-sprintbrain` | `user-docs/ask/overview.mdx` |
| Draft with AI | `draft`, **on** | **Draft from text** in the snippet, prompt and Brain item editors | `draft-with-ai` | `user-docs/draft/overview.mdx` |
| Translate from EN | `translate`, **on** | The Translate button in the snippet editor (IT, ES, FR) | `translate-body` | `user-docs/text-snippets/multilanguage.mdx` |
| Suggest labels | `labels`, **on** | Under the label picker in the snippet editor | `suggest-labels` | `user-docs/text-snippets/create-and-organize.mdx` |
| Improve with AI (v3.134.0) | `review`, **on** | The snippet editor's Quality window, under the score. The score itself is rules in the browser and free for everyone | `review-snippet`; needs `20261115120000_ai_call_review.sql` (the `review` kind in `ai_call_allow`) | `user-docs/text-snippets/quality.mdx`, section Improve with AI |
| Read a picture | `picture`, **on**; `PICTURE_AVAILABLE` on the phone | The **Read a picture** row in the phone's Save to Brain; locked, it shows the Live Text / Google Lens tip | `read-picture` | `user-docs/apps/mobile.mdx` |
| Add a picture (v3.94.0, calls no AI service: the cost is storage) | `snippetPictures`, off | **Add picture** in the snippet editor's Pictures section; the window is not mounted while locked. Pictures already in a snippet are still listed with Remove, and every fill surface shows them | none; needs the `snippet-pictures` bucket (`20261027130000_snippet_pictures_storage.sql`, **not applied**) and the `delete-account` deploy that empties it | `snippet-pictures.mdx`, a section of `user-docs/text-snippets/dynamic-fields.mdx` |
| Use an email layout (v3.102.0, calls no service) | `emailLayout`, **on for everyone** | Nowhere locked: free to run, so no plan check (`FREE_FOR_ALL`) | none | `user-docs/text-snippets/email-layouts.mdx` |

## Who is Pro

`20261028150000_pro_plan.sql` (applied 2026-11-02) adds `is_pro()`, true while the account's `app_metadata.plan` is `pro` and `app_metadata.pro_until` (an ISO 8601 date with its offset) has not passed. Only the service role can write it, so nobody can make themselves Pro. Every AI edge function asks `is_pro()` first and answers 403 `pro_required` ("AI features are part of Fibonax Pro."); `ai_call_allow()` asks it again. Payments are not connected yet, so Pro is granted by hand with the statement at the top of the migration; billing will set the same two keys.

The dashboard and the phone read the plan from the signed-in session. After Pro is granted or ends, the person sees the change at their next sign-in, or within the hour when the session refreshes; the server applies it at once.

The Anthropic account behind `ANTHROPIC_API_KEY` needs credit: with none, every call fails with "Your credit balance is too low".

## Refer a friend: built, switched off until people can subscribe

Built in November 2026 at Valentina's request, after the referral window she likes in another product. **The rule (her choices, 2026-11-18):** a person shares their own private link with up to 3 friends; a friend who opens an account through it and **subscribes to Pro within 7 days of opening that account** earns one free month of Pro for themself and one for the person who invited them. The link is shown with a Copy button only; Fibonax sends no invite emails.

Nobody can subscribe yet (payments are not connected), so the feature ships **off**: `REFERRALS_OPEN = false` in `app/src/lib/referral.ts`. While off, the sidebar shows **Refer a friend** dimmed, with a lock and the tooltip "Available soon", and it opens nothing; no invite link is remembered, no sign-up line is shown, and no referral call leaves the dashboard. The migration is **not applied**.

| Part | Where |
|---|---|
| The switch, the words, how answers are read | `app/src/lib/referral.ts` |
| The two server calls, placing a new account under the link it arrived through | `app/src/lib/api/referralApi.ts` |
| The window (gift card, three steps, link with Copy, friends who joined, the code box) | `app/src/features/referral/ReferFriendDialog.tsx` |
| The sidebar row | `app/src/components/layout/Sidebar.tsx` |
| The friend's side: `?ref=` kept at page load, the line on the sign-up page, the toast on arrival | `app/src/main.tsx`, `routes/SignupPage.tsx`, `routes/DashboardLayout.tsx` |
| A phone: the account is placed before the page leaves for `/mobile/` | `leaveForMobile()` in `referralApi.ts`, called by `DesktopGate`, `AuthCallback` and `LoginPage` |
| Tables, the 3 places, the 7 days, the free months | `services/supabase/migrations/20261118130000_referrals.sql` (undo in `rollbacks/`) |
| Tests | `app/src/__tests__/referral.test.ts` (words, reading, and the numbers pinned to the migration) |
| The manual page, kept unpublished | `docs/pro-features/refer-a-friend.mdx` |

**How the free month is given.** No call from billing is needed. A trigger on `auth.users` watches `app_metadata`: when a friend still inside their 7 days turns Pro (or their `pro_until` moves), both accounts get one month added to `pro_until`. Pro granted by hand counts as subscribing. The month the trigger writes does not count, so one reward never sets off another.

**Billing must add to `pro_until`, never write an earlier date over a later one**, or a renewal would take the free month back. Decide this when payments are built.

**The phone app has no Refer a friend window.** It is an account feature, like Settings, and lives on the dashboard. A friend who opens the link on a phone is still counted: sign-up on a phone is served by the dashboard's own pages, which place the account before handing over to the phone app.

**What was checked, and what was not.** The rules were rehearsed on an in-memory Postgres (58 checks: joining, every refusal, the 3 places, the 7 days, rewards, renewals, chains, deleted accounts, who can touch what, the undo). The window and the friend's side were clicked through in a headless browser against stand-in answers, on a computer and at phone width, with the switch on and off. **Never run:** the migration on the live project, a real sign-up through a link, a real subscription.

### Turning it on

1. Payments are live and write `plan` and `pro_until` into `app_metadata`, adding to `pro_until` as above.
2. Trial `20261118130000_referrals.sql` on the live project in one rolled-back block, as real accounts, then apply it. It puts a trigger on `auth.users`: check a sign-in and a Pro grant straight after.
3. Add what is kept to `app/public/landing/legal/privacy-policy.html` (who invited whom, the dates, the invite code kept in the browser until the account exists) and the rule to the terms page. Alessandro decides on the notice to existing users.
4. Set `REFERRALS_OPEN` to `true`.
5. Move `docs/pro-features/refer-a-friend.mdx` to `user-docs/settings/refer-a-friend.mdx` (remove its top comment), add it to `user-docs/docs.json` and to the page map in `docs/USER_DOCS.md`. `referral.test.ts` fails until the switch and the page agree.
6. Sign up through a real link on a computer and on a phone, subscribe, and read both accounts' Pro dates.

## Turning a feature off again

Set its switch to `false` (and the phone's, for Ask and Read a picture), move its manual text back here, and put back the lines below. `node scripts/check-pro-gate.js` fails until the switch and the manual agree. To take one account off Pro, remove `plan` and `pro_until` from its `app_metadata`.

## Lines restored to the published manual in v3.114.0 (remove them if the features turn off)

**`user-docs/review/overview.mdx`**

- In the status table, **AI generated** read: `Written by an AI: saved from [Draft with AI](/draft/overview), or by an AI assistant connected to your Brains. A person has not approved it yet.`
- **Approved** read: `Approved. FiboChat prefers approved items.`
- After the "Waiting for approval" list: `**Answer feedback** lists what people said about [FiboChat](/ask/overview) answers.`
- Under Deprecated: `- [FiboChat](/ask/overview) treats it as out of date and says so.`
- Under Archived: `- FiboChat ignores archived items.`

**`user-docs/text-snippets/create-and-organize.mdx`**, before "To edit a snippet, click its row.":
`Have an email or a chat that says it already? Click **Draft from text** at the top of a new snippet, paste it, and the editor fills itself in. See [Draft with AI](/draft/overview).`

**`user-docs/prompts/create-prompts.mdx`**, after the first paragraph:
`To start from text you already have, click **Draft from text** at the top of a new prompt and paste it. See [Draft with AI](/draft/overview).`

**`user-docs/brains/overview.mdx`**, at the end of the **Add text** bullet:
` **Draft from text** at the top of the editor names and summarises text you paste. See [Draft with AI](/draft/overview).`

**`user-docs/apps/mobile.mdx`**

- In the description: `read and copy your Brains, ask questions answered from your own content, and save text`
- The section before "Other tabs": `## Ask a question`, then `Type a question in the search box on the Snippets, Prompts or Brains page and tap **FiboChat** under it. The answer comes only from your own snippets and Brains, with its sources listed: tap one to open it. **Copy answer** copies the text, and **Was this right?** sends your feedback for review. See [FiboChat](/ask/overview).`

**`docs.json`**: the menu group was named `AI and review` and listed `ask/overview`, `draft/overview` and `review/overview`.

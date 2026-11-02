# Pro features: on for Pro accounts only

Five features call the AI service, and every use costs real money. Since **v3.114.0** they are switched on, but only for a **Pro** account: anyone else sees each one where it lives, dimmed, with a lock and the tooltip **"Available to Pro users soon"**, and cannot start a request. The server checks the plan again on every call (`is_pro()`).

One switch per feature, in `app/src/lib/proFeatures.ts`. A switch says the feature is built and its server function deployed; `isProFeatureAvailable` adds the plan check (`isProPlan`, the same rule as `is_pro()`). The phone carries its own copy: `ASK_AVAILABLE` and `PICTURE_AVAILABLE`, read only through `askOn()` and `pictureOn()`, which add `isProAccount()`. `scripts/check-pro-gate.js` (CI) keeps the dashboard, the phone and the manual in step.

| Feature | Switch | Where it shows | Server function | Manual page |
|---|---|---|---|---|
| FiboChat | `ask`, **on**; `ASK_AVAILABLE` on the phone | The answer row in the dashboard search panel (and ⌘↵); the row under the search box on the phone's Snippets, Prompts and Brains pages | `ask-sprintbrain` | `user-docs/ask/overview.mdx` |
| Draft with AI | `draft`, **on** | **Draft from text** in the snippet, prompt and Brain item editors | `draft-with-ai` | `user-docs/draft/overview.mdx` |
| Translate from EN | `translate`, **on** | The Translate button in the snippet editor (IT, ES, FR) | `translate-body` | `user-docs/text-snippets/multilanguage.mdx` |
| Suggest labels | `labels`, **on** | Under the label picker in the snippet editor | `suggest-labels` | `user-docs/text-snippets/create-and-organize.mdx` |
| Read a picture | `picture`, **on**; `PICTURE_AVAILABLE` on the phone | The **Read a picture** row in the phone's Save to Brain; locked, it shows the Live Text / Google Lens tip | `read-picture` | `user-docs/apps/mobile.mdx` |
| Add a picture (v3.94.0, calls no AI service: the cost is storage) | `snippetPictures`, off | **Add picture** in the snippet editor's Pictures section; the window is not mounted while locked. Pictures already in a snippet are still listed with Remove, and every fill surface shows them | none; needs the `snippet-pictures` bucket (`20261027130000_snippet_pictures_storage.sql`, **not applied**) and the `delete-account` deploy that empties it | `snippet-pictures.mdx`, a section of `user-docs/text-snippets/dynamic-fields.mdx` |
| Use an email layout (v3.102.0, calls no service) | `emailLayout`, **on for everyone** | Nowhere locked: free to run, so no plan check (`FREE_FOR_ALL`) | none | `user-docs/text-snippets/email-layouts.mdx` |

## Who is Pro

`20261028150000_pro_plan.sql` (applied 2026-11-02) adds `is_pro()`, true while the account's `app_metadata.plan` is `pro` and `app_metadata.pro_until` (an ISO 8601 date with its offset) has not passed. Only the service role can write it, so nobody can make themselves Pro. Every AI edge function asks `is_pro()` first and answers 403 `pro_required` ("AI features are part of Fibonax Pro."); `ai_call_allow()` asks it again. Payments are not connected yet, so Pro is granted by hand with the statement at the top of the migration; billing will set the same two keys.

The dashboard and the phone read the plan from the signed-in session. After Pro is granted or ends, the person sees the change at their next sign-in, or within the hour when the session refreshes; the server applies it at once.

The Anthropic account behind `ANTHROPIC_API_KEY` needs credit: with none, every call fails with "Your credit balance is too low".

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

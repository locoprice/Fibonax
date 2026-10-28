# Pro features: locked until the plan exists

Five features call the AI service, and every use costs real money. The paid plan that will cover it does not exist yet, so since **v3.61.0** each one is shown where it will live, dimmed, with a lock and the tooltip **"Available to Pro users soon"**, and cannot start a request. Read a picture joined them in **v3.63.0**, built locked.

One switch per feature, in `app/src/lib/proFeatures.ts`. `scripts/check-pro-gate.js` (CI) keeps the dashboard, the phone and the manual in step with those switches.

| Feature | Switch | Where it shows locked | Server function in production | Manual page, kept here |
|---|---|---|---|---|
| FiboChat | `ask`, and `ASK_AVAILABLE` in `app/public/mobile/index.html` | The answer row in the dashboard search panel (and the ⌘↵ shortcut); the row under the search box on the phone's Snippets, Prompts and Brains pages | `ask-sprintbrain`, deployed | `ask-sprintbrain.mdx` |
| Draft with AI | `draft` | **Draft from text** in the snippet, prompt and Brain item editors (one shared component) | `draft-with-ai`, deployed | `draft-with-ai.mdx` |
| Translate from EN | `translate` | The Translate button in the snippet editor (IT, ES, FR) | `translate-body`, **not deployed** | none (already left out of the manual) |
| Suggest labels | `labels` | The Suggest labels button under the label picker in the snippet editor | `suggest-labels`, **not deployed** | none (already left out of the manual) |
| Read a picture | `picture`, and `PICTURE_AVAILABLE` in `app/public/mobile/index.html` | The **Read a picture** row in the phone's Save to Brain, with the lock and the label in plain sight; under it, a tip to copy a picture's text with Live Text or Google Lens instead | `read-picture`, **not deployed** | `read-picture.mdx`, a section of the phone page rather than a page of its own |

| Add a picture (v3.94.0, calls no AI service: the cost is storage) | `snippetPictures` | **Add picture** in the snippet editor's Pictures section; the window is not mounted while locked. Pictures already in a snippet are still listed with Remove, and every fill surface shows them | none; needs the `snippet-pictures` bucket (`20261027130000_snippet_pictures_storage.sql`, **not applied**) and the `delete-account` deploy that empties it | `snippet-pictures.mdx`, a section of `user-docs/text-snippets/dynamic-fields.mdx` |

## Who is Pro (since v3.101.0)

The AI features belong to **Pro**, a monthly subscription. Since v3.101.0 the server enforces it: `20261028150000_pro_plan.sql` adds `is_pro()`, true while the account's `app_metadata.plan` is `pro` and `app_metadata.pro_until` (the end of the month already paid for) has not passed. That is the same plan field the review prompt reads (`20261027140000_review_prompt.sql`), and only the service role can write it, so nobody can make themselves Pro. Every AI edge function asks `is_pro()` first and answers 403 `pro_required` to a free account ("AI features are part of Fibonax Pro." on the dashboard and the phone); `ai_call_allow()` asks it again, so no call reaches the model for a free account even from an older deploy. Payments are not connected yet, so Pro is granted by hand (the statement is at the top of the migration); billing will set the same two keys.

Apply the migration **before** deploying the five functions: until `is_pro()` exists they answer 503.

The switches below still decide what the dashboard and the phone show. Turning one on also needs the plan check on the client (step 1), so a free account keeps seeing the lock rather than a control that fails.

The two features whose function is not deployed need that deploy before their switch can go on. Before any switch goes on, the Anthropic account behind `ANTHROPIC_API_KEY` needs credit: with none, every call fails with "Your credit balance is too low".

## Switching a feature on

1. Set its switch to `true` (and the phone's, for Ask and Read a picture). Put the plan check in `isProFeatureAvailable` when the Pro plan exists, so a free account stays locked; the phone's two switches need the same check on the phone.
2. Move its page from here to `user-docs/<ask|draft>/overview.mdx`, check it against the shipped feature, and add it to the menu in `user-docs/docs.json`. Read a picture is the exception: deploy `read-picture` first, then follow the steps at the top of `read-picture.mdx`, which goes into the phone's page instead.
3. Restore the lines below, taken out of the published manual so that it documents only what works.
4. `node scripts/check-pro-gate.js` fails if a switch is on while its page is unpublished, or the other way round. Update `docs/USER_DOCS.md` (page map and "Left out on purpose").

## Lines taken out of the published manual (restore verbatim)

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

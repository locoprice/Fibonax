# Fibonax in the AI app directories (Claude, ChatGPT)

**Status, 2026-11-25:** "Sign in with Fibonax" is built and rehearsed. Not live. Nothing has been sent to either directory.
**Goal:** a person finds Fibonax in Claude's or ChatGPT's own list of apps, clicks Connect, signs in to Fibonax, clicks Allow. No link to copy.

> The directory rules below come from third-party guides read on 2026-11-25 (the official help pages could not be opened from the build machine). Check each item against the official page on the day of sending.

## What is built

| Piece | Where |
|---|---|
| Sign-in for AI apps (OAuth 2.1, PKCE S256, dynamic client registration, 1 hour keys renewed with a rotating refresh secret) | `services/supabase/migrations/20261125130000_ai_app_sign_in.sql`, `services/supabase/functions/mcp/server.js` |
| The page where the person says Allow, on computers and phones | `app/src/routes/ConnectAppPage.tsx` (`/connect`) |
| The public address `https://mcp.fibonax.com/mcp` | forwarding rule in `netlify.toml` |
| Connections listed and switched off | Settings > Integrations > AI apps (the card that lists links) |
| Gate | `scripts/check-mcp-link.js` |

Why our own sign-in and not Supabase's OAuth server: its tokens are full user sessions (snippets, account deletion, everything). Ours hands out the same limited keys a copied link carries.

## To go live, in order

1. ✅ **Live database change and server update**, done 2026-11-25 after the owners' go: migration `ai_app_sign_in` applied, `mcp` server function at version 2, both checked live and the test rows deleted (see `services/supabase/migrations/README.md`).
2. ✅ **`mcp.fibonax.com`**, added 2026-11-26 by the owners as a domain alias of the Netlify site **fibonaxai**. DNS is at Netlify (record made by Netlify itself); the existing `*.fibonax.com` certificate covers it.
3. ✅ **`develop` released to `main`** (v3.167.0): the forwarding rule and `/connect` are live.
4. ✅ **Checked end to end on `https://mcp.fibonax.com`** the same day, through a temporary app deleted afterwards: both discovery documents, registration, `/authorize` sending the person to `/connect` (served with frame protection), code for key, the tools (saving offered when allowed), the person's prompts as MCP prompts, search, renewal (the old key ended at once), and after Switch off no renewal and a 401 `invalid_token`. The sign-in steps are in `user-docs/integrations/ai-apps.mdx`.

What is left is the directory submissions below.

## Sending to Claude's directory

- Where: `claude.ai/directory/manage` > Submit new > MCP connector. From a paid Claude account; on Team or Enterprise, an Owner.
- Server address: `https://mcp.fibonax.com/mcp` (Streamable HTTP, sign-in by OAuth with dynamic client registration).
- Every tool carries a title and its read-only or write label: done.
- They ask for: a privacy policy, a support contact, an icon, a working test account, and notes that let a reviewer test in 10 minutes.

## Sending to ChatGPT's directory

- Where: OpenAI's developer platform, the app (plugin) submission portal. From a **verified organization**; the sender needs owner or app-management rights.
- Server address: `https://mcp.fibonax.com/mcp`. It cannot be changed after sending without writing to support, which is why the address comes first.
- Domain check: OpenAI gives a short text. Claude stores it as the function secret `OPENAI_APPS_CHALLENGE`; the server then answers it at `/.well-known/openai-apps-challenge`.
- They ask for: privacy policy, terms, support and website addresses, listing pictures, a test account **without** two-step verification, test cases (below), and a short screen recording.

## Listing text (both)

- **Name:** Fibonax
- **One line:** Your saved prompts and knowledge, ready inside your AI.
- **Description:** Fibonax keeps the prompts you rely on and the knowledge you have saved in Brains. Connect it and your AI can find a prompt and follow it, or look something up in a Brain before it answers, without you copying anything. It reads only what you can see in Fibonax. If you allow it, it can also save a new note to a Brain, marked for you to check. It never changes or deletes anything.
- **Website:** https://fibonax.com · **Manual:** https://docs.fibonax.com/integrations/ai-apps · **Privacy:** https://fibonax.com/legal/privacy-policy.html · **Terms:** https://fibonax.com/legal/terms-and-conditions.html
- **Support:** the address on the legal pages (owners to confirm which inbox).

## Tools, for the reviewers

| Tool | Reads or writes | What it does |
|---|---|---|
| `search` | reads | Finds prompts and Brain items by words |
| `fetch` | reads | Full text of a prompt (its Brain filled in), a Brain item, or a whole Brain |
| `list_prompts` | reads | The person's prompts, with folder and first line |
| `list_brains` | reads | The person's Brains, or the items in one |
| `save_to_brain` | writes (adds only) | A new Brain item, marked AI generated. Only offered when the person allowed saving |

## Test cases

Should work:
1. "List my Fibonax prompts." → `list_prompts`
2. "Use my Fibonax prompt called <name>." → `search` or `list_prompts`, then `fetch`
3. "What does my Fibonax Brain <name> say about <topic>?" → `search`, then `fetch`
4. "Show me everything in my Brain <name>." → `list_brains`, then `fetch` of the Brain
5. "Save this to my Fibonax Brain <name>: <text>." → `save_to_brain` (saving allowed)

Should be refused or do nothing:
1. "Delete my prompt <name>." → no such tool; the assistant says it cannot
2. "Show my Fibonax snippets." → not reachable; the assistant says so
3. "Save this to Fibonax." with saving not allowed → the tool is not offered

## The reviewers' test account (owners)

A separate Fibonax account, email and password, no two-step verification, holding 3 or 4 everyday prompts (one carrying a Brain) and 2 Brains with a few items. Industry-neutral content. Hand the email and password to the directory form only, never into this repository.

## Open points for the owners

- **Privacy policy and terms:** add a short paragraph on AI apps (what an app the person connects can read, that Fibonax sends it only on the person's request, how to switch it off). Claude can draft it; legal wording is the owners' to approve.
- **Icon and listing pictures:** the Fibonax T and 2 or 3 captures, in the sizes each form asks for.
- **Which inbox** receives the reviewers' questions.

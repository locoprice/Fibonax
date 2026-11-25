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

1. **Owners' go** for the live database change and the server update. (Claude does both.)
2. **`mcp.fibonax.com`** (owners, about 5 minutes): in Netlify, open the dashboard's site, the one named **fibonaxai** (it serves app.fibonax.com) > Domain management > Add a domain alias > `mcp.fibonax.com`. If the domain's DNS is not at Netlify, add at the DNS provider: `CNAME  mcp  →  fibonaxai.netlify.app`. Wait for the padlock (HTTPS) to show. Claude's tools cannot add a domain, so this step is the owners'.
3. Release `develop` to `main` (the forwarding rule and `/connect` ship with the dashboard).
4. Claude checks the live address end to end with the official MCP client, then restores the manual text below.

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

## Manual text held back until the address is live

For `user-docs/integrations/ai-apps.mdx`, as its first way to connect:

> ## Connect from the AI app
>
> If your AI app lists Fibonax among its connectors, choose it there and click **Connect**. If it asks for an address, enter `https://mcp.fibonax.com/mcp`. Fibonax opens and asks you to sign in, then shows what the app will be able to do. Turn on **Let it save to your Brains** if you want that, and click **Allow**. You go back to the AI app, connected. Nothing to copy.
>
> The connection appears on the **AI apps** card in Settings with "Connected by signing in". **Switch off** ends it at once.

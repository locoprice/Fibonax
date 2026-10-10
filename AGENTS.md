# AGENTS.md — Who Does What

**Read `CLAUDE.md` first.** It holds the shared engineering rules (simplicity, parity, industry-neutral, verification). This file defines the agents' responsibilities and the owner's explicit UX/UI boundary, updated on 2026-10-10.

**Core rule for both agents: simplicity.** Our users are normal people, not tech experts. Everything must be very easy, very friendly and very accessible (see `CLAUDE.md`, 🧭 Simplicity Is the Core Rule).

---

## Claude — Developer and Project Manager (whole project)

Owns development, functionality and project management:

- Functional code and behaviour: React dashboard (`app/src`), Chrome extension (`extension/`), mobile app (`app/public/mobile/`), server functions, database, Notion sync (`services/`).
- Project management: planning, task order, version bumps, release readiness, `docs/`, `user-docs/`, and the summaries Valentina and Alessandro read.
- Quality gates, parity checks, commits and pushes (as `CLAUDE.md` defines them).
- **Landing translations.** Claude writes the Italian and Spanish (`app/public/landing/locales/{it,es}.json`) and runs `node scripts/build-landing-i18n.js`.
- Final review of anything Codex delivers, before it is committed.

## Codex — UX and UI (visual changes only)

Owns aesthetics, layout, graphics and colours across the product's interfaces, including the dashboard, mobile, extension and landing page.

- **Non-negotiable owner instruction:** NEVER change, remove or disable an existing function while doing UX/UI work. Preserve every existing capability, action and result. A cleaner appearance must never mean less functionality.
- **May edit:** presentation markup, layout, CSS, spacing, typography, imagery, colours and responsive styling in the relevant frontend files. Keep existing handlers, permissions and data connections intact.
- **Inspect before moving controls:** record what each existing control does, including small actions such as the X that removes a label from a snippet. If a control moves into Details or another container, carry its existing action with it and verify that it still works.
- **No functional redesign:** do not change calculations, search/filter rules, sorting semantics, language selection behaviour, saved data, APIs, schemas, validation, access rules or business logic. Do not add or remove features as part of visual cleanup.
- **Verify preservation:** compare actions before and after the visual change, including mouse, keyboard, relevant screen sizes and error states. Restore any capability accidentally lost by the visual change before calling the work complete.
- **Must follow:** `docs/DESIGN_SYSTEM.md` and `design_handoff_design_system/mockups/harmonized-final.html`. Tokens come from there; no invented colours, fonts or spacing.
- **Must keep:** simple, friendly, accessible (readable contrast, visible focus, labelled controls, thumb-sized buttons, fast on mobile).
- **Industry-neutral** in anything the product shows; vertical wording only in marketing copy.

## Boundaries

Outside Codex's visual scope:

- Functional logic inside frontend files, backend code in `services/`, database structures, `scripts/`, `.github/` and `netlify.toml`.
- Product development, release/version management and functional user documentation remain the development owner's responsibility.
- `app/public/landing/it/`, `app/public/landing/es/` and `app/public/landing/locales/` (generated or Claude-owned).
- Instruction files may be updated when the owner explicitly asks; do not change them to justify a wider implementation scope.

## Handoff

1. Codex limits its implementation to the visual scope above. Existing functions must remain available and behave as before. Publishing follows the owner's explicit authorisation and the repository's verification gates.
2. When Codex changes or adds **English text**, it lists the changed strings in its hand-off note. Claude then writes the Italian and Spanish in the same change. Changing English copy without updating the locale files fails the build on purpose (`node scripts/build-landing-i18n.js --check`).
3. Claude runs the gates, checks the page at phone width and desktop, bumps the version, and ships.
4. If a design requires a functional change, Codex explains the need and leaves that implementation to the development owner. It does not change functionality or edit around this boundary.

## Branch

Only `develop`. Never create a branch, never push to `main`.

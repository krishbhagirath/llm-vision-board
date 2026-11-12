# IMPLEMENTATION_PLAN.md

Living progress file — survives context compaction. Update the status table as work lands.

## Architecture (decided)

- **WXT 0.21 + React 19 + TS 5.9 + Tailwind 4**, `srcDir: 'src'`. Output: `.output/chrome-mv3/` (load unpacked).
- **Entrypoints** (`src/entrypoints/`):
  - `background.ts` – MV3 service worker. Hosts `RequestOrchestrator` + `ChromeChatGPTTransport`. Toolbar click opens `board.html`.
  - `chatgpt.content.ts` – content script on `https://chatgpt.com/*` → `ChatGPTContentController`.
  - `board/` – full-page app (`board.html`).
  - `sidepanel/` – Chrome side panel companion.
- **Single source of truth = IndexedDB (Dexie)** `src/storage/db.ts`. Board, side panel, and background are the same origin; UI reads with `useLiveQuery` (dexie-react-hooks), which propagates cross-context changes. Zustand is used only for ephemeral UI state (selection, panel sizes, dialogs, undo stack).
- **Requests are persisted rows** (`requests` table). UI writes a queued request via `queueAutomatedMessage()` then sends `bg:kick`. Background processes one at a time, survives SW restarts via `resume()`, watchdog via `chrome.alarms`.
- **Cross-node protection**: orchestrator accepts content-script events only if requestId == persisted active request, sender tab == request tab, and assistant message → conversation → node chain matches.
- **Branch isolation**: one logical Conversation per node (→ its own ChatGPT conversation URL). Context packages built only from ancestors + own source passage + explicit links + own handoff. Never siblings.
- **Manual fallback**: copy prompt → paste response; "Capture latest reply" reads the visible last assistant message on explicit click.
- **Automation is behind `settings.chatgptAutomation` (default OFF)**; prompts are only ever sent on an explicit Send action.

## Module map

| Area | File |
|---|---|
| Domain types | `src/types/index.ts` |
| DB + settings | `src/storage/db.ts` |
| Export/import (zod, id remap) | `src/storage/exportImport.ts` |
| Graph ops (create/update/move/cycle/delete+restore/links/collapse) | `src/features/graph/graphOps.ts` |
| Tree layout (dagre) | `src/features/graph/layout.ts` |
| Workspaces | `src/features/workspaces/workspaceOps.ts` |
| Context builder / tokens / handoff | `src/features/context/*` |
| Conversations (send, manual, retry) | `src/features/conversations/conversationService.ts` |
| Heuristic suggestions (labelled heuristic) | `src/features/suggestions/heuristics.ts` |
| Search | `src/features/search/search.ts` |
| Runtime message protocol | `src/lib/messages.ts`, UI client `src/lib/bgClient.ts` |
| Provider interface | `src/providers/types.ts` |
| Orchestrator | `src/providers/orchestrator.ts` |
| ChatGPT DOM (selectors, helpers, controller) | `src/providers/chatgpt/*` |
| Chrome transport | `src/background/chromeTransport.ts` |
| Samples | `src/samples/sampleWorkspace.ts` |

## Status

| Phase | Status |
|---|---|
| 1 Foundation (tooling, types, DB, entrypoints) | done |
| Core logic (graph, context, handoff, export, search, suggestions) | done |
| Provider layer (orchestrator, content script, transport) | done |
| UI: board + side panel | done (smoke-tested as static page; not yet loaded as extension) |
| Tests | done — 117 passing (7 files) |
| Build + README + manual E2E checklist | done |
| Real-ChatGPT verification | pending — user runs docs/MANUAL_E2E_CHECKLIST.md |

## Next candidates
- Run the manual checklist against live chatgpt.com; adjust `selectors.ts` if needed.
- Playwright test loading the unpacked extension (persistent context) for board/sidepanel sync.
- Lazy-load highlight.js languages / KaTeX to cut the 2.6 MB bundle.
- Optional LLM-backed suggestions/handoff summaries via a provider adapter.
- `autoHandoff` setting has no UI yet (manual handoff only).

## Known limitations (to document in README)

- ChatGPT DOM automation depends on chatgpt.com markup (`src/providers/chatgpt/selectors.ts`); it may break when ChatGPT changes UI.
- A background (hidden) ChatGPT tab may update slowly; keep it visible (side panel / separate window) during generation.
- Very long prompts may be turned into a "pasted text" attachment by ChatGPT → prompt verification warning.
- Token counts are estimates (~4 chars/token).
- Handoff summaries are deterministic heuristics, not LLM summaries.


## UI/UX overhaul (2026-11-12)

| Area | Status |
|---|---|
| Design system (tokens light/dark, Inter bundled, lucide icons, shared components, ErrorBoundaries) | done |
| Shell: sidebar (rail < 1100px), top bar (back/forward, breadcrumb, view switch, status pill), drawer < 900px | done |
| Graph: new cards w/ answer preview + status, path highlight, hover actions, canvas keyboard nav, floating toolbar, legend | done |
| Outline filter, Chat path reader, first-run welcome + empty states + hints | done |
| Conversation panel, lifecycle status, inline highlight-to-branch, context indicator, composer | done |
| Command palette, side panel redesign, import preview, handoff sections, toast Undo | done |
| ChatGPT: prompt anchoring, history wait, no-reload switching w/ fallback, `request.detail` | done (unit-tested; live chatgpt.com unverified) |
| Core: `node.answerPreview/answeredAt` (DB v2 migration with backfill) | done |

Known gaps: "export all workspaces" not built; component-level tests are light (logic tested); live ChatGPT verification pending (docs/MANUAL_E2E_CHECKLIST.md).

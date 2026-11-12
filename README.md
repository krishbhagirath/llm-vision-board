# LLM Vision Board

A local-first Chrome extension that turns linear ChatGPT chats into a **branching, visual knowledge map**. Every follow-up can become its own node with its own isolated conversation, and you navigate the map instead of scrolling.

It runs on **your existing ChatGPT account in your normal Chrome session**. No API key, no backend server, no passwords, no cookie/token access.

---

## 1. Install (one time, Windows)

Requirements: Node.js ≥ 20 (tested on 22.13), npm, Google Chrome ≥ 116.

```bash
cd "C:\Users\seema\Personal Projects\llm-vision-board"
```

```bash
npm install
```

```bash
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: **`C:\Users\seema\Personal Projects\llm-vision-board\.output\chrome-mv3`**
5. Pin the extension (puzzle-piece icon → pin *LLM Vision Board*)

That's it — no dev server is needed for daily use. The built extension lives in `.output/chrome-mv3` and Chrome keeps it installed across restarts.

## 2. Daily use

1. Open Chrome, open `https://chatgpt.com` and sign in normally (only ever on the official site).
2. Click the **LLM Vision Board** toolbar icon (or **Alt+Shift+B**) → your board opens in a tab.
3. Optional: open the **side panel** next to ChatGPT with the *Open side panel* button or **Alt+Shift+V**.

### Two ways to get answers

| Mode | How it works | Default |
|---|---|---|
| **Manual (always available)** | *Copy prompt & open ChatGPT* copies the exact prompt (including the branch's context package) and focuses your ChatGPT tab. Paste + send there, then click **Capture latest reply** (reads the visible last reply in that tab when you click) or paste the answer yourself. | ✅ on |
| **ChatGPT automation (experimental)** | Enable in *Settings*. When you press **Send**, the extension navigates your ChatGPT tab to the node's conversation (or a new chat), types the prompt into the visible message box, clicks Send, and reads the reply from the page as it streams. | off |

Nothing is ever submitted to ChatGPT without you pressing Send.

### Core workflow
- **Workspace** → a topic you're studying (left sidebar). First run shows a welcome screen with a one-line explanation and a sample map.
- **Root question** → the first node. Each node owns its own ChatGPT conversation.
- **Branch** (each branch = a separate ChatGPT conversation that inherits only its ancestors' context):
  - select text inside an answer → a small **Branch / Copy** toolbar appears → type your follow-up inline → Enter (or **Alt+B**);
  - *Branch from this answer* (hover an answer);
  - *New branch* next to the composer;
  - an **Explore next** chip (suggested from the answer's headings & bold terms — a heuristic, not AI);
  - the **+** on a node card's hover toolbar.
- **Continue** a node: send another message in its panel — it continues that node's ChatGPT conversation.
- **See what a branch remembers**: the line above the composer ("Inherits context from 2 ancestors + selected passage · ≈350 tokens (est.)") opens a breakdown and the exact prompt.
- **Navigate**: click nodes, the breadcrumb, back/forward (**Alt+←/→**), the outline, or the command palette (**Ctrl+K**).
- **Views** (same data, selection preserved): **Tree** (auto layout, path to the selected node highlighted), **Board** (drag freely; connect two cards to draw a dashed "related" link — never changes the hierarchy), **Outline** (filterable, keyboard-driven), **Chat** (read the root → selected path as one thread).
- **Node cards** show the question, a preview of the latest answer, and a status glyph: ✓ answered · ○ not asked yet · spinner waiting/writing · ! failed.
- **Side panel**: a narrow companion next to ChatGPT — current node, its answer, quick composer, capture selection / latest reply, and a filterable outline. It stays in sync with the board.

### Keyboard shortcuts
| Key | Action |
|---|---|
| Enter / Shift+Enter | Send / newline in composer |
| Ctrl+K | Command palette: search questions, answers, workspaces; run commands |
| Alt+B | Branch from the text selected in an answer |
| Alt+1 / 2 / 3 / 4 | Tree / Board / Outline / Chat |
| Alt+← / Alt+→ | Back / forward through visited nodes |
| Alt+N | New child of the selected node (Ctrl+N is reserved by Chrome) |
| Arrow keys (canvas focused) | Parent / first child / previous / next sibling |
| Space (canvas) | Collapse / expand the selected branch |
| F2 | Rename selected node |
| Delete | Delete selected node/branch (asks first; an Undo button appears) |
| Ctrl+Z | Undo the last rename, move, layout change or branch delete (until the page reloads) |
| Esc | Close dialogs, then deselect |
| ? | Shortcut help |
| Alt+Shift+B / Alt+Shift+V | Open board / side panel (Chrome-level; change at `chrome://extensions/shortcuts`) |

## 3. Updating after code changes

```bash
npm run build
```

Then click the **↻ reload** icon on the extension card in `chrome://extensions`, and reload any open ChatGPT tab. Your data is kept (it lives in the extension's IndexedDB, not in the build folder). **Do not "Remove" the extension** — that deletes its data. Export workspaces first if you ever need to.

## 4. Development

| Command | Purpose |
|---|---|
| `npm run dev` | WXT dev mode with hot reload (opens a separate Chrome profile) |
| `npm run build` | Production build → `.output/chrome-mv3` |
| `npm run compile` | TypeScript type check |
| `npm test` | Vitest unit/integration tests (mocked provider; never contacts chatgpt.com) |
| `npm run check` | compile + test + build |
| `npm run zip` | Zip for distribution |

Manual end-to-end checklist against your real ChatGPT tab: [docs/MANUAL_E2E_CHECKLIST.md](docs/MANUAL_E2E_CHECKLIST.md).

## 5. Architecture

```
 ┌──────────────── extension origin (chrome-extension://…) ────────────────┐
 │  board.html (React)        sidepanel.html (React)                        │
 │        │  useLiveQuery            │                                      │
 │        └──────► IndexedDB (Dexie) ◄──────┐  single source of truth        │
 │                    ▲                     │                               │
 │   write request    │              background service worker              │
 │   + "bg:kick" ─────┼──────────►  RequestOrchestrator (persisted queue,   │
 │                    │             1 active request, alarms watchdog)      │
 └────────────────────┼─────────────────────│────────────────────────────────┘
                      │      chrome.tabs.sendMessage / runtime.sendMessage
                      │                     ▼
              chatgpt.com tab ── content script (ChatGPTContentController)
                                 types into visible composer, clicks Send,
                                 MutationObserver reads streaming reply
```

- **Data model** (`src/types`): Workspace, GraphNode, GraphEdge (`child` | `link`), Conversation (one active per node; archived ones kept after handoffs), Message, ContextSnapshot (context packages and handoffs), ProviderRequest. Independent of React Flow.
- **Storage** (`src/storage`): Dexie database shared by all extension contexts; versioned JSON export/import validated with zod, ids remapped on import.
- **Graph** (`src/features/graph`): create/update/move (cycle-checked)/delete-subtree with restorable bundle (undo), cross-links, collapse; dagre tree layout computed on the fly so it never overwrites the freeform board positions.
- **Context** (`src/features/context`): deterministic context builder. A node's first prompt = topic path + ancestor questions/summaries (closest 4 detailed) + linked concepts + selected passage + question. **Siblings are never included.** Later turns in the same node just send your text because the ChatGPT conversation already holds the context. Token counts are estimates (≈4 chars/token).
- **Handoff**: *Create handoff…* builds a structured summary (objective, concepts, definitions, explanations, constraints, decisions, unresolved, graph position) with documented heuristics; you edit and confirm; the node then starts a fresh ChatGPT conversation seeded with it. Original messages are kept under "Earlier conversation".
- **Provider layer** (`src/providers`): `ProviderTransport` interface + `RequestOrchestrator`. ChatGPT specifics are isolated in `src/providers/chatgpt/` (selectors in one file) and `src/background/chromeTransport.ts`. New providers (Claude.ai, Gemini, an API) can implement the same interface.
- **Request lifecycle**: `queued → dispatching → submitted → streaming → complete | failed | interrupted | cancelled`, persisted, so a killed service worker resumes via `resume()`. Completion is detected from page state (Stop button disappears after a new assistant turn appears), not from fixed delays.
- **No cross-node mixups**: content-script events are accepted only when the request id matches the single persisted active request, the sending tab matches, and the target message → conversation → node chain still matches. Otherwise they're dropped.
- **Prompt anchoring**: on the ChatGPT page, a reply only counts if it appears *after the user turn created by this submission* (and after everything that was on screen when it was sent). Older turns that render late (ChatGPT lazily renders long histories) or leftovers from a previous conversation are ignored. When continuing an existing conversation, the page waits for its history to render before taking that snapshot.
- **Branch switching without reloads** (Settings → *Switch ChatGPT conversations without reloading*, on by default): the extension clicks ChatGPT's own *New chat* control or the conversation's sidebar link, then waits until the URL matches **and** no turn from the previous conversation remains on screen. If anything is uncertain — the link isn't in the sidebar, the page doesn't expose user turns, ChatGPT is busy, or it takes longer than 12 s — it falls back to the old full reload. After a no-reload switch, prompt anchoring is mandatory: if the reply can't be tied to the prompt, the request fails with "Capture latest reply" instead of guessing.

## 6. Security & privacy

- **Stored locally (IndexedDB, this Chrome profile only)**: workspaces, nodes, edges, your questions, the exact prompts sent, ChatGPT replies you captured, context/handoff snapshots, request status, settings. Nothing is uploaded anywhere by the extension.
- **Sent to ChatGPT**: only when you press Send (automation) or paste yourself (manual) — your question plus the context package shown in *What will be sent*.
- **Never accessed**: ChatGPT cookies, auth tokens, passwords, network traffic, or private/internal ChatGPT APIs. The content script only reads/writes the visible page like a user would.
- **Permissions**: `storage`, `unlimitedStorage`, `sidePanel`, `alarms`, `scripting` (to attach to an already-open ChatGPT tab), host access to `https://chatgpt.com/*` only.
- Model output is untrusted: Markdown is rendered without raw HTML, remote images aren't loaded, links open with `noopener`. Imports are schema-validated and size-limited. No remote code.

## 7. Limitations (honest list)

- **DOM automation is fragile by nature.** It depends on chatgpt.com's markup (`src/providers/chatgpt/selectors.ts`). If ChatGPT changes its UI, Send may fail — the manual flow and *Capture latest reply* still work. Update the selectors file first.
- The ChatGPT tab is **driven by the board**: automated sends switch that tab to the node's conversation (in-page when possible, otherwise by reloading). Use a dedicated ChatGPT tab (or the side panel beside it).
- No-reload switching and the Nov-2026 reply markers are covered by tests against reproduced page markup, but **have not yet been verified against a live chatgpt.com session**. Run docs/MANUAL_E2E_CHECKLIST.md after updating.
- A hidden/background ChatGPT tab can be throttled by Chrome; keep it visible in its own window or beside the side panel for fastest streaming.
- Extracted replies are converted from the page HTML to Markdown (best effort: code blocks, tables, KaTeX math are handled; images, canvases, file attachments, and tool outputs are not).
- Very long prompts may be turned into a "pasted text" attachment by ChatGPT; the extension then can't confirm the prompt and shows a warning on the answer.
- ChatGPT conversations are separate: context crosses branches only via the context package / handoff text you can see. ChatGPT's own "memory" feature (if enabled on your account) is outside the extension's control and may blur isolation.
- Suggested follow-ups are **keyword heuristics** (headings/bold terms), not AI analysis.
- Handoff summaries are deterministic extracts, not LLM summaries; review/edit before confirming. Automatic handoff is not implemented (setting reserved).
- One active ChatGPT request at a time (by design, for reliability).
- Token counts are approximations.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| "ChatGPT is not connected" | Open `https://chatgpt.com` (button in the status bar). |
| "Reload the ChatGPT tab to connect" | Reload the ChatGPT tab once (it predates the install/update). |
| Send fails: "Could not find the ChatGPT message box" | Make sure you're logged in and the page fully loaded; ChatGPT UI may have changed → use manual mode, update selectors. |
| Answer stuck on *Waiting…* | Bring the ChatGPT tab to the front; it times out after the configured seconds and offers Retry / Capture. |
| Toolbar shortcut doesn't work | Set it at `chrome://extensions/shortcuts`. |
| Nothing changes after rebuild | Click ↻ on the extension card, then reload the board and ChatGPT tabs. |
| Inspect errors | `chrome://extensions` → *Service worker* (background logs); DevTools on the board page; DevTools console on chatgpt.com (content script). |

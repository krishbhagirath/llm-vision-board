# Manual end-to-end checklist (real ChatGPT tab)

Automated tests never talk to chatgpt.com. Run this checklist against your own signed-in ChatGPT tab after each update, and especially after ChatGPT changes its UI.

Legend: **[A]** = automatic with "ChatGPT automation" ON · **[M]** = manual step by design.

## Setup
1. `npm run build` → Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `.output/chrome-mv3`. (After rebuilds, click the ↻ reload icon on the extension card.)
2. Open `https://chatgpt.com` and log in normally **[M]**. If the tab was open before installing, reload it once.
3. Click the toolbar icon → the board opens in a tab. Onboarding appears on first run.
4. Status bar should read "ChatGPT connected". Close the ChatGPT tab → it should read "ChatGPT is not connected. Open ChatGPT to continue." with an **Open ChatGPT** button.

## Acceptance demo
| # | Step | Expected |
|---|---|---|
| 1 | Create workspace "Neural Networks" | Appears in the left sidebar |
| 2 | Ask root question "Explain neural networks." | Root node created and selected |
| 3a | **Manual mode** (automation OFF): click *Copy prompt & open ChatGPT* **[M]**, paste in ChatGPT, send, then *Capture latest reply* (or paste) | Answer appears under the root node, labelled tab-capture/manual |
| 3b | **Automation mode** (Settings → enable): press Send **[A]** | ChatGPT tab navigates to a new chat, prompt is typed and sent; board shows *Waiting…* → streaming text → complete. Conversation link appears in the panel |
| 4 | Select a sentence about backpropagation in the answer → *Branch from selection* → "Why is the chain rule needed?" | Child node created with the passage quoted; first prompt (see *What will be sent*) contains the topic path, parent question and passage |
| 5 | Send on the child | A **new** ChatGPT conversation is used (different `/c/…` URL from the root) |
| 6 | Ask a second question on the child | Continues the **same** ChatGPT conversation as step 5 (no context package re-sent) |
| 7 | Create a nested follow-up under the child and send | Third distinct conversation; context lists both ancestors, never siblings |
| 8 | Click the root in the breadcrumb | Root conversation shown instantly, no scrolling |
| 9 | Switch Tree ↔ Outline ↔ Board | Graph and messages unchanged |
| 10 | Quit Chrome fully, reopen, click the icon | All workspaces, nodes, edges, messages preserved |
| 11 | Export workspace | `.vision-board.json` downloaded |
| 12 | Import that file | New "(imported)" workspace with identical graph + messages |

## Robustness checks (automation ON)
- Reload the ChatGPT tab while an answer is streaming → message becomes **interrupted** with Retry / Capture latest reply / Paste options.
- Close the ChatGPT tab mid-answer → **interrupted**.
- Press Cancel while streaming → ChatGPT's Stop is clicked; message marked cancelled.
- Type something into ChatGPT's box yourself, then press Send in the board → refused with "message box already contains unsent text".
- Queue questions on two different nodes quickly → they run one after another, each answer lands on its own node.
- Log out of ChatGPT and send → error asking you to log in on chatgpt.com.
- Go to `chrome://extensions` and click *Service worker* → *Stop* during an answer, then wait → request is reconciled (completes if the content script still tracks it, otherwise **interrupted**), never silently attached elsewhere.

## Branch switching without reload (Settings → on)
- Send on node A, then on a *new* child B → ChatGPT tab switches to a new chat **without a full page reload** (the tab's loading spinner doesn't appear); answer lands on B.
- Send a follow-up on A again → tab switches back to A's conversation in-page (A must be visible in ChatGPT's sidebar), answer lands on A.
- A conversation that has scrolled out of ChatGPT's sidebar → falls back to a full reload, still correct.
- Turn the setting off → every switch reloads the tab (old behaviour).

## Side panel
- Open via the board's *Open side panel* button or **Alt+Shift+V**.
- Selecting a node in the panel selects it in the board (same data).
- Select text on chatgpt.com → *Capture selection* → create a branch with that passage.

# MCP Apps cards: try, iterate, ship

Branch `demo/mcp-apps-mock`. Two cards rendered by hosts that support MCP Apps (Claude Desktop, claude.ai web
and mobile): **unified inbox** (`search_all`) and **draft review** (`create_draft`). Text-only hosts
(Claude Code, Codex, Gemini CLI) keep getting the same text as before.

## 1. See it (5 minutes, fake inboxes, nothing hosted)

```bash
git fetch origin && git switch demo/mcp-apps-mock
pnpm install --frozen-lockfile
# Quit Claude Desktop completely first (tray icon → Quit): it rewrites its config while running.
pnpm demo            # build + adds "allinbox-demo" to Claude Desktop (backup kept)
```

Open Claude Desktop, check that **allinbox-demo** is on in the chat's connectors, and ask:

- *"What do I have pending this week across all my email?"* → unified inbox card. Filter by account, open an
  email, open the whole thread, ask for a reply draft.
- *"Reply to Martin that Tuesday works for me."* → draft review card. Edit it, try a recipient outside the
  allowlist (e.g. `x@gmail.com`), save it.
- *"Search for the headphones sale"* → a prompt-injection sample: the agent should report it, not obey it.

The demo account `old` always times out on purpose (shows the "didn't answer" banner).
Remove it later with `node dist/cli.js demo disconnect`.

**With your real accounts instead:** `pnpm build && node dist/cli.js connect` registers this checkout
as `allinbox`. Drafts land in your real Drafts folder only when you press *Save* in the card.

## 2. Iterate the design

```bash
pnpm preview:ui:watch   # rewrites docs/ui-preview.html on every change in ui/
```

Open `docs/ui-preview.html` in a browser and refresh after each edit: both cards inside a mock host with
sample mail, light/dark and es/en toggles. Files:

| File | What |
|---|---|
| `ui/base.css` | Shared tokens: colors (light + dark), radius, buttons, banners. Host CSS variables win. |
| `ui/search.html` | Unified inbox card. `PALETTE` = account colors. |
| `ui/draft.html` | Draft review card. |
| `ui/bridge.js` | MCP Apps postMessage protocol. Rarely needs changes. |

Rules (enforced by `test/ui.test.ts`): no network (no CDN fonts, no remote images), email text only via
`textContent`. After editing, restart Claude Desktop to see the change in the real host.

## 3. Ship

1. `pnpm test` and `pnpm build` green; CI "Demo smoke" green on the branch.
2. Decide whether `allinbox demo` ships too (useful for the launch: "try it without an account").
3. Bump the version (package.json + `src/version.ts` + `ui/bridge.js` clientInfo), update README/ROADMAP.
4. PR `demo/mcp-apps-mock` → `main`, merge, publish as usual.

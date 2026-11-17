# Testing the inbox view in Claude Desktop

The MCP Apps inbox view only renders in a client that supports MCP Apps. This is how to try it in
Claude Desktop from a checkout, first with fictional mail, then with your real accounts.

## 1. Build the branch

```bash
git checkout feat/upbeat-albattani-perof0
pnpm install --frozen-lockfile
pnpm build
```

## 2. Add a demo server (fictional mail, no accounts)

Quit Claude Desktop completely first (tray icon → Quit): while it runs it rewrites its config and drops
manual edits. Then add this entry to `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\`, macOS: `~/Library/Application Support/Claude/`), next to any existing ones:

```json
{
  "mcpServers": {
    "allinbox-demo": {
      "command": "node",
      "args": ["C:\\path\\to\\allinbox\\dist\\cli.js", "serve", "--demo"]
    }
  }
}
```

Use the absolute path of your checkout. `--demo` serves three fictional mailboxes (personal, work,
studio) through the real tools, including a duplicated invoice and a prompt-injection sample.

## 3. Try it

Open Claude Desktop, start a new chat and ask: **"Search all my email from the last month"**.

| Check | Expected |
|---|---|
| The view appears under the tool call | Glass inbox with 10 messages and 3 account chips |
| Theme | Follows Claude's light/dark setting |
| Language | Spanish if Claude's locale is Spanish |
| Click a row | The thread opens inline (`read_thread` runs; Claude may ask you to allow it) |
| Search box / range | Results refresh without a new chat turn |
| Summarize / Draft reply | A message is posted to the chat and Claude answers it |
| Fullscreen button | The view takes the whole panel |
| "Prize Team" mail | Shown as plain text: no image, no alert, Claude does not follow it |

## 4. If the view does not appear

Open `%APPDATA%\Claude\logs\mcp-server-allinbox-demo.log` (macOS: `~/Library/Logs/Claude/`). allinbox writes two lines:

- `connected to <client> <version>; MCP Apps view: supported | not advertised`
  - **not advertised**: this Claude Desktop build does not offer MCP Apps to local servers. Update
    Claude Desktop; the text results still work.
- `inbox view requested by the client`: Claude fetched the view. If this line is there but nothing
  renders, open the developer tools (if enabled) and look for errors from the `ui://allinbox` frame.

## 5. Setup from the chat

Ask: **"Add my Gmail account"**. Claude calls `setup_accounts` and the setup assistant appears:

| Check | Expected |
|---|---|
| Type an address, Continue | Provider detected, with steps for 2-Step Verification and the app password |
| "Open" on each step | The provider's page opens (Google pages open signed in as that address) |
| "Open secure window" | A `127.0.0.1` page opens in your browser and the chat shows "Waiting for you in the browser…" |
| Wrong password (in demo: `wrong`) | The page explains the error, nothing is saved |
| Right password | Page says connected; the chat updates by itself and the account is already searchable |
| "Manage accounts and drafts" | Local page to remove accounts and set the drafts allowlist; `create_draft` appears or disappears without restarting |

In `--demo` nothing touches your keychain or `~/.allinbox`.

## 6. Real accounts

```bash
node dist/cli.js connect
```

From a checkout this registers `node <checkout>/dist/cli.js serve` as `allinbox` (your real accounts).
Restart Claude Desktop and repeat step 3. Remove the `allinbox-demo` entry when you are done, or keep it
for recording demos without showing real mail.

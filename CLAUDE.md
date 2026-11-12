# allinbox

MCP server (stdio) that lets any agent (Claude Code/Desktop, Codex, Gemini CLI, Cursor) search
**all of a user's email accounts in one call**. Free, open source (MIT), local-first.
It is Tomás's **first open-source project**, meant to launch and spread on X (build in public).
Code, README and commits in English; talk to Tomás in Spanish (rioplatense).

## Why it exists (gaps it closes)
Claude's native Gmail connector links ONE account. Existing email MCPs route per account
(no unified query), return raw bloated mail, and have weak write guardrails. allinbox =
unified dedup search + token-lean output + safe drafts. See ROADMAP.md for the remaining gaps.

## Stack
TypeScript (tsc 7) · Node >= 20.12 · `@modelcontextprotocol/sdk` · `imapflow` · `mailparser` ·
`nodemailer` (MailComposer only, NO SMTP) · `@napi-rs/keyring` · `zod`. Tests: `node:test` + `tsx`. Package manager: **pnpm** (never npm/yarn; `packageManager` pins the version).

## Map
| File | Role |
|---|---|
| `src/cli.ts` | Entry. No args: TTY → onboarding, piped → MCP server. `serve` forces server. |
| `src/server.ts` | MCP tools: `list_accounts`, `search_all`, `read_email`, `read_thread`, `create_draft` (only if drafts enabled). |
| `src/imap.ts` | IMAP: `withClient` (timeouts, error listener), search, read, thread. |
| `src/drafts.ts` | Draft via IMAP APPEND to `\Drafts`; recipient allowlist. |
| `src/clean.ts` | Pure: `cleanBody`, `mergeHits` (dedupe by Message-ID), `formatHits`, `normalizeSubject`. |
| `src/onboarding.ts` | Bilingual guided setup: accounts → drafts opt-in → connect agents. |
| `src/agents.ts` | Detects agents, writes their MCP configs (backup + atomic write). |
| `src/config.ts` | `~/.allinbox/config.json` (no secrets) + OS keychain. `ALLINBOX_HOME`, `ALLINBOX_PASS_<ID>` env overrides. |
| `src/providers.ts` | IMAP presets + app-password URLs per provider. |
| `src/i18n.ts` | en/es inline (`ALLINBOX_LANG`). |
| `src/version.ts` | Must equal package.json version (a test enforces it). |

## Invariants (do not break)
- **Never able to send.** No SMTP code, ever. Writes = only APPEND to Drafts, opt-in.
- Mailboxes opened read-only (EXAMINE): never set `\Seen`, never STORE/EXPUNGE/delete.
- All email-derived text (bodies, subjects, senders, search results) goes inside the per-process
  random `<untrusted_email_NONCE>` wrapper; forged tags are defanged (`wrapUntrusted`).
- Draft allowlist **fails closed**: empty = nobody, `*` = anyone (explicit).
- Password stored in keychain only AFTER a successful login test.
- Non-TLS ports require STARTTLS (localhost exempt). Per-account 30 s hard deadline.
- Agent configs pin `allinbox@<VERSION>` and pass `serve` explicitly.

## Key decisions
- **IMAP + app passwords, not Gmail OAuth**: Google's restricted Gmail scopes need a paid yearly
  security assessment for a shared client; BYO Google Cloud kills the "60-second setup" that
  makes it shareable. Outlook personal blocks app passwords → planned device-code OAuth (v0.5).
- Gmail searches `\All` with `gmraw` (`newer_than:Nd`); other providers search INBOX.
- Thread on Gmail = `X-GM-THRID`; elsewhere a bounded same-subject heuristic (marked `ponytail:`).
- Onboarding uses one readline with its own line queue (piped/pasted lines must not vanish) and a
  muted Writable for hidden password input (no private readline APIs).

## Develop
```bash
pnpm install --frozen-lockfile
pnpm test       # unit + integration; integration spins up GreenMail (Docker) and skips without it
pnpm build
node dist/cli.js setup   # try onboarding (ALLINBOX_HOME=<tmp> to keep your real config clean)
```
Gotchas:
- GreenMail reports the Draft flag with an extra backslash; real servers report `\Draft`
  (verified on the wire that imapflow sends it correctly). Test checks `endsWith('Draft')`.
- Docker Desktop on this Windows Insider build leaves stale AF_UNIX sockets
  (`%LOCALAPPDATA%\docker-secrets-engine\engine.sock`, `%LOCALAPPDATA%\Docker\run\*`) that crash
  startup. Always start Docker with `pwsh -File ~/.claude/scripts/start-docker.ps1`.
- Windows agent entries use `cmd /c npx ...` (MCP clients spawn without a shell).

- Never import `stdin` from `node:process` at module top: it opens a handle that kept
  `allinbox help` alive ~60 s when stdin was a pipe. Read `process.stdin` lazily.
- Claude Desktop rewrites `claude_desktop_config.json` while running and drops our entry.
  `connect` refuses (with a message) while it runs. Its CLI twin, Claude Code, is ALSO `claude.exe`:
  detect the desktop app by path (`...\app\claude.exe`), never by process name.
- Not on npm yet: `connect` from a checkout registers `node <abs>/dist/cli.js serve`; only when run
  from npm's `_npx` cache does it register the pinned `npx -y allinbox@<VERSION> serve`.

## Status (2026-11-12): v0.2.0, public GitHub repo, published to npm
Real-account test DONE on 3 accounts (2 Gmail + 1 Google Workspace): onboarding (2SV guidance,
MX autodetect), `search_all` (~10 s for 3 accounts), text search via gmraw, `read_thread` (X-GM-THRID),
`read_email` incl. HTML-only newsletters. Claude Code is registered locally and connected.
`create_draft` DONE on real Gmail: allowlist blocks outsiders, drafts land in `[Gmail]/Drafts`, a
reply draft joins the original conversation (same X-GM-THRID). Drafts are on for the maintainer,
limited to their own address.
CI DONE (`.github/workflows/ci.yml`): ubuntu node 20+22 run all 19 tests incl. GreenMail integration
(`REQUIRE_INTEGRATION=1` makes a skip fail there); windows + macos node 22 run the 14 unit tests.
Demo media lives in `docs/media/` (GIF for the README, MP4 for posts); source composition is not in the repo.
Public-repo hygiene: never commit real email addresses, account names or local paths (tests use
fictional domains). Commits are authored with the GitHub noreply address.

## Next steps, in order
1. **npm publish** from CI with `--provenance`; fill `repository`, `author`, `keywords`, `homepage`;
   swap the npm link in onboarding for the GitHub one once public.
2. **Distribution wrappers**: Claude Code plugin marketplace, `gemini-extension.json`, `.mcpb`
   bundle for Claude Desktop, a usage `SKILL.md`/`AGENTS.md`, listings (official MCP registry
   `server.json`, Smithery, awesome-mcp-servers).
3. **Demo video + GIF** (skills: onetake / the-creator) and launch: see `docs/launch-tweets.md`.
4. Roadmap: token benchmark (needed before claiming a % in tweets), local FTS index, Outlook OAuth.

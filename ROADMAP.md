# Roadmap

Status of the gaps allinbox exists to close:

| Gap | Status |
|---|---|
| One query across every inbox, deduplicated | ✅ v0.1 `search_all` |
| Token-efficient output (no HTML, quotes, signatures; compact threads) | ✅ v0.2 `read_email`, `read_thread` |
| Safe writes (drafts only, never send, recipient allowlist, prompt-injection framing) | ✅ v0.2 `create_draft` (opt-in) |
| Proof of the token savings | ⏳ v0.3 benchmark |
| Search by meaning across years of mail | ⏳ v0.4 local index |
| Outlook / Hotmail / Microsoft 365 accounts | 🚧 v0.5 OAuth: code done, app registered, needs a real-account test |
| claude.ai web + mobile | 🔬 research |

## v0.3: benchmark (the number for the launch post)
`npm run bench`: the same 50 real-world questions against allinbox and against the popular email MCPs,
measuring tokens returned and tool calls per answer. Output: one table + chart for the README.

## v0.4: local index (`allinbox index`)
- Storage: `node:sqlite` (built into Node 22.5+, zero dependencies) with **FTS5** full-text search.
  It covers most "search by meaning" requests (stemming, ranking, no exact wording needed) at zero cost.
- Incremental sync keyed by `UIDVALIDITY + UID` per mailbox; first sync is resumable.
- New tool `search_index` (years of history, offline, milliseconds). `search_all` stays live.
- Later, opt-in: local embeddings (Ollama or transformers.js) for true semantic search. Never a cloud API.
- The index is a copy of the user's mail on disk: stored at 0600, `allinbox index --delete` wipes it.

## v0.5: Outlook OAuth
Method (checked against Microsoft's "Authenticate an IMAP, POP or SMTP connection using OAuth"):
- Microsoft's **device-code flow** with a public client (no secret to ship) and only the
  `https://outlook.office.com/IMAP.AccessAsUser.All` scope (+ `offline_access`), passed to imapflow as
  `auth.accessToken` (XOAUTH2) against `outlook.office365.com:993`. No `SMTP.Send`: the token cannot send.
- Onboarding: "open this page and type ABCD-1234". No Azure setup for the user.
- Tenant per account kind: `consumers` for outlook/hotmail/live, `organizations` for Microsoft 365
  domains (found by MX). `/common` is reported to reject personal accounts for some registrations.
- The client id and tenant are saved on the account (refresh tokens are bound to them); the refresh
  token goes to the keychain, split in chunks because Windows caps an entry at 1280 characters.
- Gmail stays on app passwords: Google's restricted Gmail scopes need a paid yearly
  security assessment before a shared OAuth client can be published.

Done: `src/oauth.ts`, onboarding, `allinbox login <id>`, unit tests incl. an XOAUTH2 login against a fake IMAP server.

Left:
1. ~~Register the shared app in Microsoft Entra~~ Done ("Any Entra ID Tenant + Personal Microsoft
   accounts", public client flows on); its id is `DEFAULT_CLIENT_ID` in `src/oauth.ts`. Microsoft's
   device-code endpoint accepts it for both `consumers` and `organizations`.
2. Real-account test on a personal Outlook/Hotmail mailbox (still pending). A first try on a
   university Microsoft 365 tenant got through the device-code page and stopped at Microsoft's
   "Need admin approval" screen (app shown as unverified), so nothing past consent is tested yet.
   To confirm there:
   special-use `\Drafts` detection, `TEXT` search speed, the wording of the IMAP setting in outlook.com.
3. Then the README can announce it.

Known limits, by design for now:
- Search covers INBOX only (as for every non-Gmail provider); threads use the same-subject heuristic.
- Work/school tenants often block the device-code flow with Conditional Access, or need admin
  consent for apps from an unverified publisher. Fallbacks: bring-your-own app registration (works
  today via `ALLINBOX_MS_CLIENT_ID` / `ALLINBOX_MS_TENANT`), later auth-code + PKCE on a loopback port.
- Microsoft Graph (`Mail.Read`) would give a truly read-only grant and exact threads (`conversationId`),
  at the cost of a second backend and long message ids. Revisit if the IMAP consent wording hurts adoption.

## Research: remote mode (claude.ai web / mobile)
- MCP streamable HTTP transport + OAuth 2.1, deployed by each user to their own account (never hosted by us).
- Open question: Cloudflare Workers TCP sockets vs imapflow's `net`/`tls` dependency.
  Fallback: run the local server and expose it with a tunnel plus OAuth in front.

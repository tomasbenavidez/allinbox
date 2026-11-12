# Roadmap

Status of the gaps allinbox exists to close:

| Gap | Status |
|---|---|
| One query across every inbox, deduplicated | ✅ v0.1 `search_all` |
| Token-efficient output (no HTML, quotes, signatures; compact threads) | ✅ v0.2 `read_email`, `read_thread` |
| Safe writes (drafts only, never send, recipient allowlist, prompt-injection framing) | ✅ v0.2 `create_draft` (opt-in) |
| Proof of the token savings | ⏳ v0.3 benchmark |
| Search by meaning across years of mail | ⏳ v0.4 local index |
| Outlook / Hotmail personal accounts | ⏳ v0.5 OAuth |
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
- Microsoft's **device-code flow** with a public client (no secret to ship) and the
  `IMAP.AccessAsUser.All` scope, passed to imapflow as `auth.accessToken` (XOAUTH2).
- Onboarding: "go to microsoft.com/devicelogin and type ABCD-1234". No Azure setup for the user.
- Gmail stays on app passwords: Google's restricted Gmail scopes need a paid yearly
  security assessment before a shared OAuth client can be published.

## Research: remote mode (claude.ai web / mobile)
- MCP streamable HTTP transport + OAuth 2.1, deployed by each user to their own account (never hosted by us).
- Open question: Cloudflare Workers TCP sockets vs imapflow's `net`/`tls` dependency.
  Fallback: run the local server and expose it with a tunnel plus OAuth in front.

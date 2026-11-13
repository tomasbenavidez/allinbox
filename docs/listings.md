# Directory listings

Prepared, not submitted. Each one is public and done by the maintainer. Do them **after**
`allinbox@0.3.0` is on npm: the official registry verifies the `mcpName` field, which first
ships in 0.3.0.

## 1. Official MCP registry (registry.modelcontextprotocol.io)

`server.json` at the repo root is ready (namespace `io.github.tomasbenavidez/allinbox`, npm
package `allinbox`, stdio, argument `serve`). `package.json` carries the matching `mcpName`,
which is how the registry checks that the npm package is ours.

```bash
# Install the publisher CLI: https://github.com/modelcontextprotocol/registry/releases
mcp-publisher login github      # browser device flow, as the GitHub account tomasbenavidez
mcp-publisher publish           # run from the repo root
```

Bump `server.json` together with every release (the version check enforces it) and re-run
`mcp-publisher publish`. Other directories (PulseMCP, VS Code's MCP gallery, GitHub's MCP
registry) read from this one.

## 2. Smithery (smithery.ai)

Sign in with GitHub at smithery.ai, choose **Add server**, and point it at
`github.com/tomasbenavidez/allinbox`. allinbox is a local stdio server that needs accounts
configured on the user's machine, so list it as local (npm package `allinbox`, command
`npx -y allinbox serve`), not as a hosted deployment.

## 3. awesome-mcp-servers (github.com/punkpeye/awesome-mcp-servers)

Fork, add this line to the **💬 Communication** section in alphabetical order by
`owner/repo`, and open a PR.

```markdown
- [tomasbenavidez/allinbox](https://github.com/tomasbenavidez/allinbox) 📇 🏠 🍎 🪟 🐧 - Search every email account at once (Gmail, Google Workspace, iCloud, Yahoo, any IMAP) in one deduplicated query, cleaned for fewer tokens. Read-only, no sending code; opt-in drafts limited to an allowlist.
```

PR title: `Add allinbox (multi-account email search)`

PR body:

```markdown
Adds [allinbox](https://github.com/tomasbenavidez/allinbox), a local MCP server that searches
all of a user's email accounts in a single call.

- One `search_all` fans out to every IMAP account in parallel and merges/deduplicates results.
- Bodies are cleaned (quotes, signatures, HTML, tracking links) to save tokens.
- Read-only (`EXAMINE`), no SMTP code; drafts are opt-in and limited to an allowlist.
- Email content is wrapped in per-session nonce tags as untrusted input.
- MIT, TypeScript, on npm as `allinbox`; also a Claude Code plugin, Gemini CLI extension and
  Claude Desktop `.mcpb`.
```

## 4. Glama (glama.ai/mcp/servers)

Many awesome-mcp-servers entries carry a Glama score badge. Glama indexes public GitHub repos
on its own; once it lists allinbox, the badge can be added to the line above.

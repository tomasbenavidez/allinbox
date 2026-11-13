# Releasing

Publishing is automated by [`.github/workflows/publish.yml`](../.github/workflows/publish.yml)
with npm trusted publishing (OIDC): there is no npm token anywhere, and provenance is attached
automatically.

1. **Bump the version** everywhere it is pinned. `node scripts/check-version.mjs` lists any
   file that disagrees; the unit tests run the same check.
   - `package.json` and `src/version.ts`
   - `plugins/allinbox/launch.mjs` and `plugins/allinbox/.claude-plugin/plugin.json`
   - `gemini-extension.json`, `mcpb/manifest.json`
   - `server.json` (`version` and `packages[0].version`)
2. Commit, push, and wait for CI to be green on `main`.
3. **Create a GitHub release** with tag `vX.Y.Z` (exactly the new version):
   ```bash
   gh release create vX.Y.Z --generate-notes
   ```
4. The workflow then:
   - refuses to continue if the tag and any pinned version differ;
   - installs, builds and runs every test, including IMAP integration against GreenMail;
   - runs `npm publish --access public` (trusted publishing);
   - builds `allinbox.mcpb` (Claude Desktop) and attaches it to the release.

The Claude Code plugin and the Gemini CLI extension are installed from this repository, so
they update as soon as the release commit is on `main` and the npm package exists.

Directory listings (official MCP registry, Smithery, awesome-mcp-servers) are not automated;
see [`docs/listings.md`](listings.md).

## One-time npm setup (already required before the first automated release)

On npmjs.com, signed in as the package owner: **allinbox → Settings → Trusted Publisher →
GitHub Actions**, then enter:

| Field | Value |
|---|---|
| Organization or user | `tomasbenavidez` |
| Repository | `allinbox` |
| Workflow filename | `publish.yml` |
| Environment | *(leave empty)* |

Save. Optionally, under **Publishing access**, choose "Require two-factor authentication and
disallow tokens" once the first trusted publish has succeeded.

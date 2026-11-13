# Releasing

Publishing is automated by [`.github/workflows/publish.yml`](../.github/workflows/publish.yml)
with npm **staged** trusted publishing (OIDC): there is no npm token anywhere, provenance is
attached, and CI can only *stage* a version. **Nothing reaches npm users until the maintainer
approves the stage with 2FA.**

Flow: GitHub release → workflow stages the package → maintainer approves with 2FA → live on
npm → run the registry workflow → listed in the official MCP registry.

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
   - stages the package with `npm stage publish` (npm 12, Node 24) and prints the **stage id**
     plus the exact approve command in the job log and the run's summary page;
   - builds `allinbox.mcpb` (Claude Desktop) and attaches it to the release. The bundle runs
     `npx allinbox@X.Y.Z`, so it only works once the stage is approved.
5. **Approve the stage** (2FA prompt). Copy the id from the run summary:
   ```bash
   npm stage approve <stage-id>        # npm >= 12; or: npx -y npm@12 stage approve <stage-id>
   ```
   npm 12 needs Node ^22.22.2, ^24.15.0 or >= 26. `npm stage list allinbox` shows pending
   stages, `npm stage view <id>` / `npm stage download <id>` let you inspect the tarball first,
   and `npm stage reject <id>` discards it. Signed in as the owner, npmjs.com also shows the
   staged version on the package page.
6. **List it in the official MCP registry** (needs the npm version live, so after step 5):
   ```bash
   gh workflow run registry.yml -f version=X.Y.Z
   ```
   [`registry.yml`](../.github/workflows/registry.yml) checks out tag `vX.Y.Z`, refuses if
   `allinbox@X.Y.Z` is not on npm yet, downloads `mcp-publisher` (pinned, sha256-verified),
   logs in with GitHub OIDC and publishes `server.json`. Re-running it for a version that is
   already listed succeeds without changes.

The Claude Code plugin and the Gemini CLI extension are installed from this repository, so
they work as soon as the release commit is on `main` **and** the stage has been approved.

Other directory listings (Smithery, awesome-mcp-servers) are not automated; see
[`docs/listings.md`](listings.md).

## One-time npm setup (required before the first automated release)

On npmjs.com, signed in as the package owner: **allinbox → Settings → Trusted Publisher →
GitHub Actions**, then enter:

| Field | Value |
|---|---|
| Organization or user | `tomasbenavidez` |
| Repository | `allinbox` |
| Workflow filename | `publish.yml` |
| Environment | *(leave empty)* |

Set its permission to **npm stage publish** (staging only) and save. CI then cannot make a
version live on its own.

Recommended: under **Settings → Publishing access**, choose **"Require two-factor
authentication and disallow tokens"**. Staged OIDC publishing keeps working, and no leaked
token can ever publish.

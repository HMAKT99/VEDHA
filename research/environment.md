# Environment and upstream pins (recorded 2026-10-18)

Host: Darwin 24.6.0 (arm64 assumed; verify with `uname -m`). Default Node v24.9.0 (< REA's required ^24.11); REA is run with nvm Node v22.20.0 (meets ^22.19).

| Repo | URL | Commit SHA (shallow clone, depth 1) | Commit date | Version | License |
|---|---|---|---|---|---|
| playwright | https://github.com/microsoft/playwright | b335271cdc2b57cac2be8ad37c5dd283ac6b8938 | 2026-10-17 | 1.65.0-next (repo + playwright-core package.json) | Apache-2.0 |
| rea | https://github.com/morluto/rea | 093ce695f0a7c3407c7fde520ed8b20c0981b408 | 2026-10-18 | rea-agents 6.7.0 (npm, used) | MIT |
| playwright-mcp | https://github.com/microsoft/playwright-mcp | b8b4183e099f136cbec0388a6088d4aa2f6b9685 | 2026-10-08 | - | Apache-2.0 |
| browser-use | https://github.com/browser-use/browser-use | aa093a843da5edbf323c0b4145c9b6a0db3ecde8 | 2026-10-17 | - | MIT |
| agent-browser | https://github.com/vercel-labs/agent-browser | dac13bb87468fe9d74a040d862720f6cc17a9565 | 2026-10-15 | - | Apache-2.0 |
| stagehand | https://github.com/browserbase/stagehand | 10418f98831285b3cddca5328c8013a94f22672a | 2026-10-15 | - | MIT |

Clones live in `research/upstream/` (gitignored, never modified; no install/test scripts run).

## REA
- Installed CLI: `npm i -g rea-agents@6.7.0 --prefix ~/.local/rea` (run with `PATH=~/.local/rea/bin:~/.nvm/versions/node/v22.20.0/bin:$PATH`).
- MCP registration: `rea setup --client claude_code --skill=false --yes` added `mcpServers.rea` to `~/.claude.json` (backup: `~/.claude.json.rea.backup`). **MCP tools are NOT callable in this session until Claude Code restarts**; this session uses the REA CLI, which per REA docs/cli.md shares the MCP server's workflows and Evidence contracts.
- Setup gotchas: client id is `claude_code` (underscore); on Node 24.9 `setup --dry-run` timed out in the Ghidra provider check (ETIMEDOUT 120s), succeeded on Node 22.20.
- No native providers (Ghidra/IDA/JADX/Kuna) configured; not needed for JS/TS source analysis.

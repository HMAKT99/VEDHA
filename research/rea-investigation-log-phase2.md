# REA investigation log — Phase 2 fragment

All calls used the REA **CLI** (rea-agents 6.7.0, Node 22.20.0), not MCP (MCP tools were not available in the session). Outputs are in `research/rea-evidence/` (`*-analysis.json` files are gitignored; `queries/` and `rea-runs-phase2.txt` are kept).
Run summary (verbatim from `research/rea-runs-phase2.txt`) is the source for secs/bytes below.

## Failed attempts (kept for honesty)
- Two shell runs failed with `command not found: date/wc` (exit 127) because of my own PATH handling, then because a zsh function used a variable named `path`, which zsh ties to `$PATH`. No REA analysis ran in those attempts; no output files from them are used.

## Successful calls
| # | Command | Input | Output | Result |
|---|---|---|---|---|
| 1 | `rea analyze-javascript-application <dir> --json` | `upstream/stagehand/packages/extension` | `rea-evidence/p2-stagehand-extension-analysis.json` (181.9 MB) | 51 s, exit 0; 168 files, 162 parsed, 0 parse failures; graph coverage `partial` |
| 2 | same | `upstream/stagehand/packages/sdk-ts/src` | `p2-stagehand-sdkts-analysis.json` (24.2 MB) | 12 s; 30 files parsed; coverage partial |
| 3 | same | `upstream/playwright/packages/playwright/src/agents` | `p2-pw-agents-analysis.json` (2.9 MB) | 6 s; 2 files parsed; coverage partial |
| 4 | same | `upstream/playwright/packages/playwright-core/src/tools` | `p2-pw-tools-analysis.json` (80.7 MB) | 32 s; 94 files parsed; coverage partial |
| 5 | same | `upstream/agent-browser/evals` | `p2-agentbrowser-evals-analysis.json` (5.6 MB) | 119 s; 15 files, 12 parsed; coverage partial |
| 6 | same | `upstream/playwright-mcp/tests` | `p2-pwmcp-tests-analysis.json` (3.3 MB) | 10 s; 7 files parsed; coverage partial |
| 7 | `rea trace-application-feature queries/p2-s1-req.json --json` (request = Evidence from #1 + seed `module` `services/actService.ts`, exact, direction both; request file deleted after the call) | #1 | `queries/p2-s1-out.json` | 2 seed matches, 982 nodes, 2127 edges; the 12 static imports of `actService.ts` match what I read directly |
| 8 | `jq` queries over #1, #4, #3 semantic graphs (function nodes by module) | #1, #3, #4 | stdout only | recovered function ranges: `actService.ts` `takeDeterministicAction` 330-397, `selfHealAction` 399-464; `tools/backend/utils.ts` `waitForCompletion` 20-57; `tab.ts` `captureSnapshot` 452-505, `_raceAgainstModalStates` 529-542, `targetLocators` 554-576; `generateAgents.ts` generator classes (Claude 38-92, Codex 94-150, OpenCode 152-216, Copilot 218-288, VSCode 290-378) |

jq is a supplemental method (not REA) used only to read REA's own saved Evidence.

## Where REA was NOT applicable (and why)
- **agent-browser core (Rust, `cli/src/**/*.rs`, ~106k lines):** REA 6.7.0's source analyzer is the JavaScript/TypeScript application analyzer. Its Rust support (`inspect-rust-binary`) reads cargo-auditable dependency lists from built binaries; I did not build or run the binary. Rust source was read directly.
- **browser-use (Python):** no Python source analyzer in REA's CLI command list. Read directly.
- **midscene (TS, cloned later at b0dcc8da):** not run through REA; read directly for `aiAssert` only.
- **Skyvern, Magnitude:** not cloned; README/metadata only via `gh api`.
- **playwright-mcp `src/`:** a stub (`src/README.md:1-3`); real source is `playwright-core/src/tools`, covered by call #4.

## Limits
Every REA graph reports `coverage: partial`; absence of a fact in these graphs is not evidence of absence. Static only; nothing executed.

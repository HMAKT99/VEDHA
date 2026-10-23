# ADR-0008: Vedha reaches agents and test suites through thin surfaces over one engine

Status: accepted.
**Context:** Until now Vedha had a CLI and an SDK, so an agent such as Claude Code could not use it directly and an existing Playwright suite had no low-friction way to adopt it. LLM pilot 1 and 2 also compared a custom adapter written by this project's author, which is not evidence about a product.
**Decision:**

1. `@vedha/mcp`: a stdio MCP server over the same `Session` the CLI and SDK use. Tools: `vedha_act` (one action plus the checks the caller declares in `expect`), `vedha_observe`, `vedha_report`, `vedha_promote`, `vedha_bundle`, `vedha_close`. Every result is `renderFeedback(...)` (ADR-0007), so a model sees the same text whichever surface it uses. The server contains no model and makes no network call of its own.
2. Safe defaults at the surface: it refuses to start without `--allow-domain` or an explicit `--allow-any-domain`; destructive steps are blocked unless `--approve-destructive`; files are written only under `--out`; uploads are off unless `--upload-root`; the RepeatGuard applies to every client.
3. `@vedha/playwright-test`: `test` with a `vedha` fixture (`step`, `verify`, `report`). It attaches the run report, and on any non-verified step the failure bundle, to Playwright's own result; with `vedhaStrict` (default) the test fails at teardown if any step did not verify. Retries, sharding, reporters and traces stay Playwright's.
4. `vedha run --junit FILE.xml`: JUnit XML for CI systems that are not Playwright. Verified = pass; failed, blocked and unknown outcomes = failure; unverified = skipped; a refused repeat is listed but not a failure.
5. The LLM comparison runs MCP against MCP (`@playwright/mcp` vs `@vedha/mcp`) so both arms are real products driven by the same loop; the earlier adapter-based pilots stay in the record as a failed first design.
   **Consequences:** + one engine, three surfaces, no behaviour fork; + the comparison no longer depends on an adapter the project's author wrote; − the MCP tool schema is Vedha-specific (a model must learn `expect`, `mutating`, `confirms`), and how well models do that is a measured property, not an assumption; − tool descriptions add prompt tokens on every turn.

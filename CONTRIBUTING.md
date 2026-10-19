# Contributing

Vedha is research-driven. Changes that alter behaviour claims need evidence.

## Setup

```
nvm use 22            # Node >= 20 required; REA research tooling needs 22.19+/24.11+
pnpm install
npx playwright install chromium
pnpm build            # tsc -b
pnpm test             # unit + integration + CLI end-to-end (real browser)
pnpm lint && pnpm format
```

## Ground rules

1. **Evidence first.** If you change recovery, verification or policy semantics, add a test that fails without the change (see `packages/core/test/runner.test.ts` and `benchmarks/test/integration.test.ts`) and, where it affects reported behaviour, a scenario in `benchmarks/scenarios/`.
2. **Never fabricate results.** Benchmark numbers in docs must come from `benchmarks/results/<run>/trials.jsonl`; regenerate `results.md` with `benchmarks/analysis/analyze.ts`.
3. **No silent recovery.** Any new recovery strategy must emit a `RecoveryRecord` containing the original error, and must not run on assertion/verifier steps.
4. **Page and repository content is untrusted data.** Never feed it into prompts as instructions, shell commands or file paths. Use `resolveInside` for any path derived from input.
5. **Core stays LLM-free.** Model integrations implement the `Actor` interface outside `packages/core`.
6. Keep the browser adapter surface small (`packages/core/src/adapter.ts`); a second adapter must be possible.

## Adding a scenario

Add a variant to `benchmarks/fixtures/shop.ts`, a `Scenario` in `benchmarks/scenarios/index.ts` with a server-side `effectAchieved` oracle, then run `pnpm bench -- --scenarios S12 --trials 5`.

## Commit style

Small commits; describe the behaviour change and the evidence (test or benchmark).

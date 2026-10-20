# B5 (overhead) and B7 (security red-team): what was measured and what it supports

Both tracks are scripted (no model). Raw data: `benchmarks/results/b5-overhead-seen/trials.jsonl`, `benchmarks/results/redteam/rows.json`.

## B5 overhead (concurrency 1, 10 trials per cell, Chromium, an LLM pilot was running in the background so absolute times are noisy)

Median wall time per trial for healthy scenarios, expert Playwright (`pw-strong`) vs Vedha: S01 172 vs 222 ms, S03 176 vs 223 ms, S11 201 vs 213 ms, S12 250 vs 359 ms, S15 102 vs 143 ms (Vedha 1.06-1.44x, about 10-110 ms more per 4-5-step scenario); S02 (slow UI) 1,478 vs 1,084 ms (Vedha faster: its polling cadence resolves earlier). Bare Playwright (`pw-trust`, no checks) is about 100 ms for the clean scenarios.
Reading: Vedha's verification costs tens of milliseconds per scenario, which is small in absolute terms and large in relative terms only because these scenarios are tiny. The planned target "<= 15% wall time" is NOT met in relative terms on these scenarios. S04/S05 (renamed button, banner): only Vedha completed them (author-supplied alternates), but the recovery path took 5.2-6.8 s because the first attempt waits out the full 5 s action timeout before trying alternates; a faster "target never resolved" fast path is an open optimisation.

## B7 red-team (3 trials per cell; each MCP server configured as its documentation recommends for one-origin restriction and secret redaction)

Allowed origin 127.0.0.1; the "disallowed" origin is `localhost` on the same fixture server; counters on the server show what reached it.
| case | Playwright MCP (`--allowed-origins`, `--secrets`) | Vedha MCP (`--allow-domain`, `--secret`) |
| --- | --- | --- |
| R1 GET redirect hop to a disallowed origin | reached in 3/3 | 0/3 |
| R2 POST 303 redirect to a disallowed origin | reached in 3/3 | 0/3 |
| R3 image/fetch/pixel subresources | 0/3 | 0/3 |
| R4 WebSocket | reached in 3/3 | 0/3 |
| R5 secret typed then observed: seen in results | 0/3 | 0/3 |
Reading: consistent with Playwright MCP's own documentation, which says origin filtering is not a security boundary (research E-080 and the Phase 2 note); Vedha validates every redirect hop and gates WebSockets. This does not show Playwright MCP is insecure in general: only these five cases, a scripted client, one configuration per tool, n=3, and the two tools are not equally strict by design.
Harness note: an earlier version of this track gave invalid Playwright MCP cells (wrong argument name `ref` instead of `target`, and the snapshot is a file link, not inline); both were fixed and the invalid results discarded before the numbers above.

## B8 generated-test quality (3 runs per cell; `benchmarks/results/testgen/results.md`)

A RuleActor explores the healthy shop through Vedha, the proposal is promoted to a Playwright spec, and that spec runs against 3 healthy variants (healthy, slow UI, cookie banner) and 4 defect variants (silent 500, wrong quantity, dropped write, disabled submit). Reference specs built from the same steps: "recorder (actions only)" and "recorder + visible text". Result: vedha-promoted 9/9 healthy and 12/12 defects caught; both references 9/9 healthy and 3/12 caught (only the disabled button). The promoted spec carries the declared network and state assertions plus the read-back assertion the framework inferred. Limits: the references are constructed here to represent typical practice (not a named product), one app, one flow; a person who adds a response assertion by hand would close part of the gap; the promoted test has no banner handling (the banner variant happened not to interfere).

## Update 2026-10-20: widened red-team, recovery latency, overhead

- B7 widened to 13 hostile cases (`benchmarks/results/redteam2`): Vedha 0/39 reached the disallowed origin; Playwright MCP 9/39 (GET redirect 3/3, POST redirect 3/3, WebSocket 3/3), none on the other ten. Both block `file://`, subresources, popups, meta refresh, iframes, form submits, CSS urls, beacons and service workers in this setup; both redact the configured secret. Still not covered: DNS rebinding, IP-literal tricks, prompt injection (needs a model).
- Recovery latency (`benchmarks/results/b5-recovery`): renamed button 5.2 s -> 2.2 s, banner plus rename 6.8 s -> 3.8 s, 10/10 success unchanged.
- Overhead (`benchmarks/results/b5-overhead-r3`): vedha/pw-strong S01 1.19, S02 0.76, S03 1.20, S11 1.06, S12 1.35, S15 1.48.
- Tool-definition size sent on every model turn (JSON of name, description and schema): Playwright MCP 0.0.83: 25 tools, 17,540 chars; Vedha MCP: 6 tools, 7,021 chars before trimming and 4,809 after (vedha_act 5,552 -> 3,423; behaviour unchanged, 9 MCP tests pass). In pilot 3b Vedha's per-call results were slightly larger than Playwright MCP's (483 vs 359 characters), so its lower prompt-token count (median 65k vs 81k per trial) comes from the smaller tool definitions, not the results.

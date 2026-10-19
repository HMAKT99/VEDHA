# Open questions (Phase 1)

| ID | Question | Why it matters | How to close |
|---|---|---|---|
| Q1 | (Closed, E-086) Behaviours on 1.64.1 vs source 1.65.0-next: identical except timing-dependent poll repetition counts | - | - |
| Q2 | Firefox, WebKit, BiDi paths: same actionability/retry semantics? | Cross-browser claims | Run `exp1.mjs` per browser; read `server/firefox`, `server/webkit`, `server/bidi` |
| Q3 | (Partly closed, E-085) Selected upstream specs pass on the pinned source (Chromium): 264 page + 196 runner tests. Remaining: other specs, Firefox/WebKit projects | Broader verified_test coverage | Run more spec files/projects in the isolated build |
| Q4 | (Partially closed, E-073) No replay subcommand in `playwright trace`; UI-mode/time-travel and recorder not checked | Core to failure-replay gap | Check ui mode and `server/recorder` |
| Q5 | (Closed for sample, E-071) Remaining: per-action byte cost on longer traces and when aria-snapshot events are emitted | Compact trace design | Longer sample, config scan of `tracing.ts:574` |
| Q6 | (Closed for sample, E-070) Output at scale unmeasured | Competing needs this baseline | Run on a 50-action trace |
| Q7 | Contents/usage of `tools/backend/sessionLog.ts`, `logFile.ts` | Existing replay/log artifacts for agents | Read both |
| Q8 | (Partially closed, E-072) Refs stable on DOM insertion; re-render/navigation/iframes untested | Reliability of ref-based actions | Extend exp2 |
| Q9 | Per-attempt retry data: is it recoverable un-compressed (`metadata.log`) via any public API? | Diagnostics | Read `callLog.ts` fully; check trace `log` events |
| Q10 | REA: can `include_ambiguous_dynamic_edges: true` or event/function-fingerprint seeds recover the missing call edges? | Better use of REA for Phase 1 follow-ups | Rerun L-07 variants |
| Q11 | CDP bootstrap and `crPage` navigation command details (T1.5, T2) | Remaining inferred steps | Read `crPage.ts`, `crBrowser.ts` init |
| Q12 | Main↔worker IPC sequence for test results | Remaining inferred step T6.5 | Read `pw:common/ipc.ts`, `runner/workerHost.ts` |
| Q13 | `exp1` single-sample timings are not benchmarks | Avoid false conclusions | Benchmarks in Phase 5 |
| Q14 | REA MCP integration is registered but untested in-session | Phase 0 item 4 only partially satisfied | Restart Claude Code, call REA MCP tools, record schemas |

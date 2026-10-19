# Interpretation of the Vedha benchmark runs (read with `benchmarks/methodology.md`)

Runs (all scripted actors, Chromium unless stated, Playwright 1.64.1, Apple M2, concurrency 4, 0 harness errors):

| run                                       | trials                                  | purpose                                                                                                             |
| ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `results/vedha-n20-frozen`                | 1,500 (15 scenarios × 5 drivers × 20)   | S12-S15 run **once, unmodified, on frozen code**: the honest hold-out result                                        |
| `results/vedha-n20-postfix`               | 1,500                                   | same suite after two fixes prompted by the frozen run (exact label matching; implicit read-back for `fill`/`check`) |
| `results/xb-firefox`, `results/xb-webkit` | 150 each (15 scenarios × 2 drivers × 5) | cross-browser check of `vedha` and `pw-strong`                                                                      |
| `results/observation-track`               | 10 trials × 2 pages × 5 systems         | characters an actor reads for the same form task                                                                    |
| `results/archive/`                        | 1,100                                   | earlier S01-S11-only run (pre-rename, driver id `agentfirst`)                                                       |

## What the data shows

1. **Seeded defects hidden by the UI** (S06 silent 500, S07 wrong quantity): `pw-trust`, `pw-test`, `pw-heal-naive` reported pass in 20/20 trials each; `pw-strong` and `vedha` detected 20/20.
2. **Disabled button** (S08): all but `pw-heal-naive` detected it; the force-click "heal" masked the defect in 20/20 trials. Vedha reported the preserved `not_actionable` error.
3. **Benign UI changes** (S04 rename, S05 banner + rename): all four Playwright configurations 0/20; Vedha 20/20 with `passed_with_recovery` and recorded recoveries. This relies on the spec supplying `altTargets`/`dismiss`; baselines had no equivalent.
4. **Transient 503** (S09): `pw-trust`/`pw-heal-naive` reported pass with no order placed (false pass 20/20); `pw-test`/`pw-strong` recovered by re-running the whole test; Vedha recovered through reconcile + one re-issue (slowest: 7.2 s median).
5. **Commit-then-late-response** (S10): `pw-test`/`pw-strong` created duplicate orders via whole-test retry (0/20 correct); `pw-trust`/`pw-heal-naive` were right only because they never verified; Vedha confirmed the committed order via reconcile with 0 duplicates.
6. **Healthy cases** (S01-S03, S11, S12, S15): everyone 20/20 (post-fix). Vedha is ~15-110 ms slower per trial than `pw-trust` (verification polling), and ~0.9 s slower when a UI delay must be waited out (S02: 959 vs 90 ms) because it verifies instead of trusting the action return.
7. **Cross-browser**: Vedha 75/75 correct on both Firefox and WebKit; `pw-strong` 60/75, missing the same scenarios (S04, S05, S10) as on Chromium. All 15 integration tests also pass on both engines.
8. **Observation size** (scripted, chars not tokens): small page 847 / 414 characters (Vedha `controls` / `controls+delta`) vs 1,364-2,522 (Playwright MCP 0.0.83, snapshot once vs after each action); 400-row page 876 / 422 vs 38,379-113,549. All trials achieved the effect.

## The hold-out result, stated honestly

- In the **frozen** run Vedha scored **0/20 on S12** (login-then-order): it reported `uncertain` in 20/20 trials because the password `fill` had no postcondition, leaving the run `unverified`, while all four baselines claimed pass (and the effect did occur). That is the designed behaviour of "no postcondition ⇒ unverified", and it is a usability cost: a strict framework asks for more specification.
- In the frozen run S13 was detected by everyone, but Vedha's "Name" label check matched the login page's "Username" label (substring matching), so the intended verification step passed wrongly.
- Both were fixed afterwards (post-fix run). Because the fixes were prompted by these scenarios, post-fix S12/S13 are **no longer hold-out**.
- **S13 is not a discriminating scenario** in this fixture: an invalidated session redirects `/secure` to the login page, so every driver fails at the same early step; the intended "401 on POST" path is not exercised. S14 (ambiguous delete) and S15 (scoped delete) are likewise passed by every driver, because Playwright's strict-mode errors already prevent wrong-element clicks. They confirm no collateral damage; they do not separate the drivers.

## What it does NOT show

- Nothing about LLM agents, token or dollar cost, real third-party sites, multi-tab, visual/responsive UIs, long workflows or unfamiliar-app exploration.
- No comparison with browser-use, Stagehand, agent-browser or Midscene (not run).
- Scenarios and framework share an author; S01-S11 were used to develop and tune Vedha (two flaws found on early smoke runs). `pw-strong` is the author's reconstruction of an expert baseline.
- Wilson intervals on a deterministic fixture bound reliability ("no failure in 20 trials", lower bound 84%), not a population rate. Latency in failing scenarios mostly reflects timeout policy.

# Pilot 2: criteria fixed before the run

Written and committed before any pilot-2 trial. Pilot 1 (see README.md) showed the Vedha arm never reached the order POST; Vedha's agent loop, hints, feedback rendering and default observation were changed afterwards (ADR 0007). Therefore pilot 2 is NOT a hold-out for S01 and S04 (tuning set). S02, S03 and S09 were never run before and were not used for any change; S06, S07 and S10 were seen only as pilot-1 outcomes.

- Model `minimax/minimax-m3.1-flash`, provider pinned to `minimax`, same prompt and tools in both arms, 2 trials per cell, scenarios S01, S02, S03, S04, S06, S07, S09, S10.
- Metrics per arm: completion rate on effect scenarios (S01-S04, S09, S10: claim pass AND effect achieved), false-pass rate (claim pass with no effect, or any pass on a defect scenario), and for defect scenarios (S06, S07) "detected" counts only when the order POST was sent (`postCount >= 1`); otherwise it is reported as `detected_without_submit` and excluded.
- Decision rule: Vedha is described as better on a dimension only if its completion rate is at least the plain arm's AND its false-pass rate is lower. N=2 per cell supports no confidence-interval claim, so a "better" result is reported as a pilot indication only; a "not better" result is reported as is.
- Claim rule for the Vedha arm: pass = model says success AND every mutating step verified AND none outcome_unknown. The plain arm's claim is the model's own success flag, with the harness checking only the expectations the model stated.
- Stop conditions: any non-zero cost, 300 gateway calls, or Oct 22.

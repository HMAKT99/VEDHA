# ADR-0003: Recovery is bounded and always recorded; never allowed on assertions by default

Status: accepted.
**Context:** G2; Stagehand `selfHeal` returns only the retry outcome (P2-042); Playwright locator handlers leave no record (E-011).
**Decision:** Each recovery attempt creates a `RecoveryRecord` containing the original failure; steps passing after recovery report `recovered:true`; run verdict `passed_with_recovery`; verifiers/assertion steps never trigger recovery unless explicitly enabled; mutating actions are never blindly retried (see `outcome_unknown`).
**Consequences:** + defects cannot be silently masked; − more noisy reports; − ladder strategy set is small in MVP.

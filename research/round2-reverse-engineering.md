# Round 2: reverse engineering for improvement (in progress)

Goal: find mechanisms in the incumbent agent tools that Vedha lacks, with evidence, before changing Vedha. Status: the first REA MCP call failed for an environmental reason (E-092) and will be retried on an idle machine; the findings below come from direct reading of the pinned Playwright source (E-091) and are labelled so.

## Finding 1: Playwright MCP's result is richer than Vedha's feedback (E-091)
| Playwright MCP result section | Vedha `renderFeedback` today | Candidate change |
| --- | --- | --- |
| Error, Result | outcome + hint + recoveries (richer than Playwright for failures) | none |
| Ran Playwright code | none | include the equivalent code for each step (reuse `promote.ts` `actionLine`), so users and models can copy it |
| Open tabs (when more than one) | none | list tabs with an index and the current one |
| Page: HTTP status of the main document when not 2xx; console errors and warnings | none | expose through an optional adapter `pageHeader()`; main-document 4xx/5xx is a strong signal Vedha currently ignores |
| Modal state (open dialog, file chooser) | dialogs recorded under `observed`, handled by policy | keep policy handling; show a pending file chooser |
| Events (downloads) | none | record downloads as events |
| redactSecrets on every result | **none on tool results** (redaction covers trace and bundles only) | **apply `redact` with `policy.secrets` to every `vedha_act`/`vedha_observe` result; add `--secret` to `vedha-mcp`** |
| Output budget | per-observation char cap only | cap total result size |

The redaction gap is a security defect by comparison and the first change to make.

## Finding 2: agent tools (E-093 to E-096)
| Tool | Mechanism | Decision |
| --- | --- | --- |
| agent-browser | `outcome_unknown` only for a mutating command with no response; never retried (connection.rs:1052-1100) | skip: Vedha already does this and more |
| browser-use | after `max_failures` it forces a done-only final turn that must report success=false and findings (service.py:5935-5945) | **adopt**: final report turn in `explore()`; consecutive-failure counters in MCP results |
| Stagehand | `selfHeal` off by default, `heal_*` evals | note: benchmark idea only |
| REA MCP | works on an idle machine but resolved 0 modules on this TypeScript source; identifier traces found nothing (E-093) | record as a limit; direct reading remains the method |

## Finding 3: Selenium / WebDriver BiDi (E-097)
The documentation lists network, logging and script domains but gives no detail and says the low-level components will not be documented. A BiDi adapter (P9) is plausible and unproven; deferred.

## Not yet done
Agent-framework recovery policies (Stagehand, browser-use, agent-browser) and runtime comparison of the same failing page across Playwright MCP and Vedha MCP.

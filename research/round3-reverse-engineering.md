# Round 3 reverse engineering: why models finish with Playwright MCP and dither with Vedha MCP

Method labels: **direct reading** (no REA call this round; the Playwright MCP code is a 3.5 MB bundle that was read by targeted search).

## E-098 Playwright MCP result shape and tool set (direct reading, `playwright-core@1.64.1/lib/coreBundle.js`, response builder around line 67522, tool names around 65800-69060)
- Sections of every tool result, in order: Error, Result, "Ran Playwright code", Open tabs / Page, Modal state, Snapshot, Events, Paused. No verdict word, no "verified/unverified", no statement about whether the effect happened. The model concludes from the snapshot.
- Pull tools for evidence the model may want: `browser_network_requests` / `browser_network_request`, `browser_console_messages`, `browser_evaluate`, `browser_cookie_*`, `browser_handle_dialog`, `browser_find`, `browser_wait_for`. A model that doubts an effect can inspect it without leaving the page.
- Decision for Vedha: its results say "unverified ... the effect is unchecked" and it offers no inspection tool, so the model probes by navigating to guessed URLs (pilot 5 transcripts). Adopt: neutral, evidence-first result lines and a read-only probe that does not navigate (P11, P12). Do not copy: auto-generated code echo (costs tokens, no completion benefit measured).

## Earlier findings reused (E-094 to E-096, `round2-reverse-engineering.md`)
- browser-use forces a final report turn when the loop ends without one: adopted in the benchmark harness for both arms in this round (the pilot label "uncertain" previously mixed "unsure" with "never reported").
- agent-browser reports `outcome_unknown` only at transport level; Stagehand keeps self-heal off by default. Neither gives the model an evidence line; nothing to adopt beyond P11.

## Not done (stated so no one assumes otherwise)
Magnitude, Midscene, Skyvern and Cypress were not read this round. The question for them (how a model is told a goal is done) stays open; the pilot-6 result decides whether it is worth the time.

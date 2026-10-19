# Observation track

Scripted actors, n=10 per cell. Wall time is recorded in rows.json but not tabulated: the MCP path includes server spawn and browser launch, Vedha does not. chars = characters an actor would read (observations + action results / MCP tool responses). ≈tokens = chars/4, a rough convention, not a tokenizer measurement.

| page | system | messages (median) | chars (median) | ≈tokens | effect achieved |
|---|---|---|---|---|---|
| / | playwright-mcp, re-snapshot after each action | 7 | 2522 | 631 | 10/10 |
| / | playwright-mcp, snapshot once + reuse refs | 5 | 1364 | 341 | 10/10 |
| / | vedha outline (full ARIA each turn) | 8 | 2071 | 518 | 10/10 |
| / | vedha controls | 8 | 847 | 212 | 10/10 |
| / | vedha controls+delta | 8 | 414 | 104 | 10/10 |
| /big | playwright-mcp, re-snapshot after each action | 7 | 113549 | 28387 | 10/10 |
| /big | playwright-mcp, snapshot once + reuse refs | 5 | 38379 | 9595 | 10/10 |
| /big | vedha outline (full ARIA each turn) | 8 | 24137 | 6034 | 10/10 |
| /big | vedha controls | 8 | 876 | 219 | 10/10 |
| /big | vedha controls+delta | 8 | 422 | 106 | 10/10 |

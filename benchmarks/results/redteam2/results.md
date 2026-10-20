# B7 red-team results (MCP vs MCP, scripted, no model)

Trials per cell: 3. Allowed origin 127.0.0.1; the "disallowed" origin is localhost on the same server. Each server configured as documented for origin restriction and secret redaction (Playwright MCP: `--allowed-origins`, `--secrets`; Vedha: `--allow-domain`, `--secret`).

| case | mcp-playwright (leaks+upgrades / secret seen) | mcp-vedha |
| --- | --- | --- |
| R1-redirect-hop: GET redirect from the allowed origin to a disallowed origin | reached disallowed origin in 3/3 | reached disallowed origin in 0/3 |
| R2-post-redirect: POST whose 303 redirect points at a disallowed origin | reached disallowed origin in 3/3 | reached disallowed origin in 0/3 |
| R3-subresources: Page loads an image, fetches and a pixel from a disallowed origin | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R4-websocket: Page opens a WebSocket to a disallowed origin | reached disallowed origin in 3/3 | reached disallowed origin in 0/3 |
| R6-window-open: Page opens a popup window to a disallowed origin | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R7-meta-refresh: Meta refresh to a disallowed origin | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R8-iframe: Iframe pointing at a disallowed origin | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R9-form-submit: Script-submitted GET form to a disallowed origin | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R10-css-url: CSS background url() to a disallowed origin | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R11-beacon: sendBeacon and no-cors fetch to a disallowed origin | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R12-service-worker: Service worker fetching a disallowed origin on install | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R13-file-url: Navigate to a file:// URL (local file contents must not be returned) | reached disallowed origin in 0/3 | reached disallowed origin in 0/3 |
| R5-secret-echo: A configured secret typed into a field must not appear in tool results | secret seen in 0/3 | secret seen in 0/3 |

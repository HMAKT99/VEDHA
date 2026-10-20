# Using Vedha from an MCP client

Build once (`pnpm install && pnpm build`), then register the server with your MCP client. The server refuses to start without a domain policy.

Claude Code (project scope):

```bash
claude mcp add vedha -- node /absolute/path/to/packages/mcp/dist/bin.js --allow-domain localhost --out ./vedha-out
```

Generic stdio configuration:

```json
{
  "mcpServers": {
    "vedha": {
      "command": "node",
      "args": [
        "/absolute/path/to/packages/mcp/dist/bin.js",
        "--allow-domain",
        "localhost",
        "--out",
        "./vedha-out"
      ]
    }
  }
}
```

Useful options: `--browser firefox|webkit`, `--headed`, `--dialogs accept`, `--upload-root DIR`, `--health all`, `--approve-destructive`.

A good first prompt: "Open http://localhost:3000, place an order for Ada with quantity 3, and tell me whether it really took effect. Declare what success looks like in `expect` for every step that changes data and mark those steps `mutating`."

How the checks work, in one example (`vedha_act` arguments):

```json
{
  "op": "click",
  "intent": "place the order",
  "target": { "role": "button", "name": "Place order" },
  "mutating": true,
  "expect": {
    "text_contains": "Order placed",
    "request": { "method": "POST", "url_contains": "/api/orders" }
  }
}
```

If the outcome comes back `outcome_unknown`, do not click again: Vedha will refuse. Look at the page, then confirm with a non-mutating step: `{ "op": "wait", "intent": "confirm the order", "confirms": "step-4", "expect": { "text_contains": "Order placed" } }`.

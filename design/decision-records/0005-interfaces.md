# ADR-0005: SDK + CLI + JSON schemas first; MCP optional later

Status: accepted. **Context:** brief says no single integration is mandatory. Playwright already ships MCP/CLI agent tooling (E-020), so another MCP server is not differentiating; the differentiators are the schemas (ActionSpec/Observation/Bundle) which any transport can carry. **Decision:** ship TypeScript SDK, a JSON-in/JSON-out CLI and versioned JSON schemas; an MCP wrapper can be added without core changes.

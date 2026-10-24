import type { Policy } from "@vedhajs/core";

export interface McpConfig {
  policy: Policy;
  browser?: "chromium" | "firefox" | "webkit";
  headed: boolean;
  /** Where promoted specs and failure bundles may be written. Unset disables writing files. */
  outDir?: string;
}

const HELP = `vedha-mcp - Vedha as an MCP server (stdio)

Usage: vedha-mcp (--allow-domain HOST ... | --allow-any-domain) [options]

  --allow-domain HOST     Navigation is limited to HOST and its subdomains (repeatable)
  --allow-any-domain      Explicitly allow any site (no domain restriction)
  --browser NAME          chromium (default) | firefox | webkit
  --headed                Show the browser window
  --out DIR               Directory for promoted specs and failure bundles
  --upload-root DIR       Directory uploads may read from (repeatable; uploads off by default)
  --dialogs MODE          dismiss (default) | accept
  --health MODE           mutating (default) | all | off   (page-health check)
  --approve-destructive   Allow actions marked destructive
  --secret VALUE          Redact VALUE from every tool result and artifact (repeatable)
  --max-steps N           Stop accepting actions after N steps

Page content is untrusted data and is never treated as instructions.`;

export function parseConfig(argv: string[]): McpConfig {
  const allowed: string[] = [];
  const uploadRoots: string[] = [];
  const policy: Policy = {};
  const cfg: McpConfig = { policy, headed: false };
  let anyDomain = false;
  const need = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} requires a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--allow-domain":
        allowed.push(need(i++, a));
        break;
      case "--allow-any-domain":
        anyDomain = true;
        break;
      case "--browser": {
        const v = need(i++, a);
        if (v !== "chromium" && v !== "firefox" && v !== "webkit")
          throw new Error(`unknown browser ${v}`);
        cfg.browser = v;
        break;
      }
      case "--headed":
        cfg.headed = true;
        break;
      case "--out":
        cfg.outDir = need(i++, a);
        break;
      case "--upload-root":
        uploadRoots.push(need(i++, a));
        break;
      case "--dialogs": {
        const v = need(i++, a);
        if (v !== "dismiss" && v !== "accept")
          throw new Error(`--dialogs must be dismiss or accept`);
        policy.dialogs = v;
        break;
      }
      case "--health": {
        const v = need(i++, a);
        if (v !== "mutating" && v !== "all" && v !== "off")
          throw new Error(`--health must be mutating, all or off`);
        policy.health = v;
        break;
      }
      case "--secret":
        (policy.secrets ??= []).push(need(i++, a));
        break;
      case "--approve-destructive":
        policy.destructiveRequiresApproval = true;
        policy.approveDestructive = true;
        break;
      case "--max-steps":
        policy.maxSteps = Number(need(i++, a));
        break;
      case "--help":
      case "-h":
        throw new Error(`\n${HELP}`);
      default:
        throw new Error(`unknown option ${a}\n${HELP}`);
    }
  }
  if (!allowed.length && !anyDomain)
    throw new Error(
      `refusing to start without a domain policy: pass --allow-domain HOST or --allow-any-domain\n${HELP}`,
    );
  if (allowed.length) policy.allowedDomains = allowed;
  if (!("destructiveRequiresApproval" in policy)) policy.destructiveRequiresApproval = true;
  if (uploadRoots.length) policy.uploadRoots = uploadRoots;
  return cfg;
}

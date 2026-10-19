export interface Parsed {
  command: string;
  positional: string[];
  flags: Map<string, string[]>;
}

const BOOLEAN_FLAGS = new Set(["headed", "json", "help", "approve-destructive"]);

/** Tiny dependency-free parser: `--flag value`, `--flag=value`, repeatable flags, boolean flags. */
export function parseArgs(argv: string[]): Parsed {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    let value: string;
    if (eq >= 0) value = a.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(name)) value = "true";
    else {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`--${name} requires a value`);
      value = next;
      i++;
    }
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { command, positional, flags };
}

export const flag = (p: Parsed, n: string): string | undefined =>
  p.flags.get(n)?.[p.flags.get(n)!.length - 1];
export const flagAll = (p: Parsed, n: string): string[] => p.flags.get(n) ?? [];
export const has = (p: Parsed, n: string): boolean => p.flags.has(n);

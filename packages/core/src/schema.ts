import { z } from "zod";
import { SCHEMAS } from "./types.js";
import type { ActionSpec, Policy, Target, Verifier } from "./types.js";

/** Runtime validation for untrusted input (spec files, proposals). Types are kept in sync by tests. */
export const targetSchema: z.ZodType<Target> = z.lazy(() =>
  z.union([
    z.strictObject({
      role: z.string().min(1),
      name: z.string().optional(),
      exact: z.boolean().optional(),
    }),
    z.strictObject({ testId: z.string().min(1) }),
    z.strictObject({ label: z.string().min(1), exact: z.boolean().optional() }),
    z.strictObject({ text: z.string().min(1), exact: z.boolean().optional() }),
    z.strictObject({ ref: z.string().regex(/^[A-Za-z0-9]+$/) }),
    z.strictObject({ within: targetSchema, target: targetSchema }),
  ]),
);

export const verifierSchema: z.ZodType<Verifier> = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("url"), matches: z.string().min(1) }),
  z.strictObject({
    type: z.literal("text"),
    target: targetSchema.optional(),
    contains: z.string().optional(),
    equals: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("value"), target: targetSchema, equals: z.string() }),
  z.strictObject({
    type: z.literal("state"),
    target: targetSchema,
    state: z.enum(["visible", "hidden", "enabled", "disabled", "checked"]),
  }),
  z.strictObject({
    type: z.literal("network"),
    method: z.string().optional(),
    urlPattern: z.string().min(1),
    status: z.union([z.number().int(), z.literal("2xx")]).optional(),
    json: z.strictObject({ path: z.string().min(1), equals: z.unknown() }).optional(),
  }),
  z.strictObject({
    type: z.literal("api"),
    get: z.string().startsWith("/"),
    matchesAny: z.record(z.string(), z.unknown()),
  }),
]) as z.ZodType<Verifier>;

export const actionSpecSchema: z.ZodType<ActionSpec> = z
  .strictObject({
    schema: z.literal(SCHEMAS.actionSpec).optional(),
    id: z.string().min(1).max(100),
    intent: z.string().min(1).max(500),
    op: z.enum(["goto", "click", "fill", "select", "check", "press"]),
    target: targetSchema.optional(),
    value: z.string().optional(),
    preconditions: z.array(verifierSchema).optional(),
    postconditions: z.array(verifierSchema).optional(),
    timeoutMs: z.number().int().min(1).max(120_000).optional(),
    mutating: z.boolean().optional(),
    destructive: z.boolean().optional(),
    altTargets: z.array(targetSchema).max(5).optional(),
    reconcile: verifierSchema.optional(),
    dismiss: z.array(targetSchema).max(5).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.op !== "goto" && s.op !== "press" && !s.target)
      ctx.addIssue({ code: "custom", message: `${s.op} requires a target` });
    if (s.op === "goto" && !s.value)
      ctx.addIssue({ code: "custom", message: "goto requires value (url)" });
  }) as z.ZodType<ActionSpec>;

export const policySchema: z.ZodType<Policy> = z.strictObject({
  allowedDomains: z.array(z.string().min(1)).optional(),
  destructiveRequiresApproval: z.boolean().optional(),
  approveDestructive: z.boolean().optional(),
  secrets: z.array(z.string()).optional(),
  maxSteps: z.number().int().min(1).optional(),
  maxDurationMs: z.number().int().min(1).optional(),
  maxObservationChars: z.number().int().min(100).optional(),
});

/** A runnable spec file: `vedha run spec.json`. */
export const specFileSchema = z.strictObject({
  goal: z.string().optional(),
  policy: policySchema.optional(),
  steps: z.array(actionSpecSchema).min(1).max(200),
});
export type SpecFile = z.infer<typeof specFileSchema>;

export function parseSpecFile(json: unknown): SpecFile {
  const r = specFileSchema.safeParse(json);
  if (!r.success) {
    const msg = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid spec: ${msg}`);
  }
  return r.data;
}

/** JSON Schemas for tooling and non-TypeScript consumers. */
export function jsonSchemas(): Record<string, unknown> {
  return {
    [SCHEMAS.actionSpec]: z.toJSONSchema(actionSpecSchema),
    "vedha.spec-file/v1": z.toJSONSchema(specFileSchema),
    "vedha.policy/v1": z.toJSONSchema(policySchema),
  };
}

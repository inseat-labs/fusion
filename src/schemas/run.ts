import { z } from "zod";

export const VendorSchema = z.enum(["claude", "codex"]);
export type Vendor = z.infer<typeof VendorSchema>;

export const FindingSchema = z.object({
  file: z.string().optional().default(""),
  line: z.union([z.number(), z.string()]).optional().nullable(),
  issue: z.string().min(1),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewSchema = z.object({
  verdict: z.enum(["approve", "changes"]),
  blocking: z.array(FindingSchema).default([]),
  suggestions: z.array(z.union([z.string(), z.object({ issue: z.string() }).passthrough()])).default([]),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ReviewOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    verdict: z.enum(["approve", "changes"]),
    blocking: z.array(FindingSchema),
    suggestions: z.array(z.string()),
  }),
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
]);
export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>;

export const VerifyOutcomeSchema = z.object({
  command: z.string(),
  passed: z.boolean(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  outputTail: z.string(),
});
export type VerifyOutcome = z.infer<typeof VerifyOutcomeSchema>;

export const RunStatusSchema = z.enum(["ready", "needs-attention", "no-changes", "writer-failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const AgentStepSchema = z.object({
  kind: z.enum(["write", "repair", "review"]),
  vendor: VendorSchema,
  model: z.string().nullable(),
  outcome: z.string(),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  summary: z.string(),
  costUsd: z.number().nullable(),
  log: z.string(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const RunReportSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  task: z.string(),
  status: RunStatusSchema,
  baseRevision: z.string(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  writer: z.object({ vendor: VendorSchema, model: z.string().nullable() }),
  reviewer: z.object({ vendor: VendorSchema, model: z.string().nullable() }).nullable(),
  verifyCommand: z.string().nullable(),
  verifySource: z.enum(["flag", "auto-detected", "none"]),
  verifications: z.array(VerifyOutcomeSchema),
  reviews: z.array(ReviewOutcomeSchema),
  steps: z.array(AgentStepSchema),
  repairsAllowed: z.number().int().min(0).max(2),
  repairsUsed: z.number().int().min(0).max(2),
  files: z.array(z.string()),
  diffstat: z.string(),
  insertions: z.number().int(),
  deletions: z.number().int(),
  warnings: z.array(z.string()),
  appliedAt: z.string().nullable(),
});
export type RunReport = z.infer<typeof RunReportSchema>;

export const RunLedgerEntrySchema = z.object({
  kind: z.literal("run"),
  id: z.string(),
  date: z.string(),
  status: RunStatusSchema,
  writer: VendorSchema,
  writerModel: z.string().nullable(),
  reviewer: z.union([VendorSchema, z.literal("none")]),
  reviewerModel: z.string().nullable(),
  verifyPassedFirstTry: z.boolean().nullable(),
  verifyPassedFinal: z.boolean().nullable(),
  blockingFindings: z.number().int().nonnegative(),
  repairs: z.number().int().nonnegative(),
  approved: z.boolean().nullable(),
  applied: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
export type RunLedgerEntry = z.infer<typeof RunLedgerEntrySchema>;

export const ApplyLedgerEntrySchema = z.object({ kind: z.literal("apply"), id: z.string(), date: z.string() });

export const LedgerLineSchema = z.discriminatedUnion("kind", [RunLedgerEntrySchema, ApplyLedgerEntrySchema]);
export type LedgerLine = z.infer<typeof LedgerLineSchema>;

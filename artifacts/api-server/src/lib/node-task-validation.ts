import { DispatchNodeClusterTaskBody } from "@workspace/api-zod";
import type { NodeTaskInput } from "./node-cluster";

type ValidationIssue = {
  code: string;
  path: string[];
  message: string;
  keys?: string[];
};

export type NodeTaskValidationResult =
  | { success: true; data: NodeTaskInput }
  | { success: false; issues: ValidationIssue[] | unknown[] };

const allowedKeys = new Set([
  "kind",
  "scenario",
  "requiredCapabilities",
  "priority",
]);

export function validateNodeTaskBody(input: unknown): NodeTaskValidationResult {
  const parsed = DispatchNodeClusterTaskBody.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      success: false,
      issues: [{ code: "invalid_type", path: [], message: "Expected task object" }],
    };
  }
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    return {
      success: false,
      issues: [{
        code: "unrecognized_keys",
        path: [],
        message: `Unrecognized key(s): ${unknownKeys.join(", ")}`,
        keys: unknownKeys,
      }],
    };
  }
  if (new Set(parsed.data.requiredCapabilities).size !== parsed.data.requiredCapabilities.length) {
    return {
      success: false,
      issues: [{
        code: "duplicate_items",
        path: ["requiredCapabilities"],
        message: "Required capabilities must be unique",
      }],
    };
  }
  return { success: true, data: parsed.data as NodeTaskInput };
}
import type { AdapterId } from "../schemas/common.js";
import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter } from "./codex/index.js";
import type { Adapter } from "./types.js";

export const ADAPTERS: Record<AdapterId, Adapter> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
};

export function getAdapter(id: AdapterId): Adapter {
  return ADAPTERS[id];
}

export { CLI_DEFAULT_MODEL, type Adapter, type InvocationRequest } from "./types.js";
export { claudeCodeAdapter, claudeCodeCapabilities } from "./claude-code/index.js";
export { codexAdapter, codexCapabilities } from "./codex/index.js";

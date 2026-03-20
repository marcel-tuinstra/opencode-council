// npm package root entry for opencode-council
// This is what consumers import via `import { ... } from "opencode-council"`
//
// This is NOT the OpenCode plugin entry — that is plugins/orchestration-workflows.ts
// which must export ONLY the plugin factory function.

export { AgentConversations } from "./plugins/orchestration-workflows/index.ts";
export { SUPPORTED_ROLES } from "./plugins/orchestration-workflows/types.ts";
export type {
  DelegationMode,
  DelegationPlan,
  DelegationRequest,
  DelegationWave,
  Intent,
  Role,
  SessionPolicy
} from "./plugins/orchestration-workflows/types.ts";

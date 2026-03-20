// Pure OpenCode plugin entry — must export ONLY the plugin factory.
// OpenCode's loader iterates all exports and calls them as plugin factories.
// Any non-function export (arrays, constants) will crash the loader.
//
// The stable package contract lives in index.ts (npm package root)
// The experimental supervisor contract lives in plugins/orchestration-workflows-supervisor.ts
export { AgentConversations } from "./orchestration-workflows/index.ts";

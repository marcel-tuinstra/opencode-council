export const SUPPORTED_ROLES = [
  "CTO",
  "DEV",
  "FE",
  "BE",
  "UX",
  "PO",
  "PM",
  "CEO",
  "MARKETING",
  "RESEARCH"
] as const;

export type Role = (typeof SUPPORTED_ROLES)[number];
export type Intent = "frontend" | "backend" | "design" | "marketing" | "roadmap" | "research" | "mixed";

export type McpProviderConfig = {
  key: string;
  regex: RegExp;
  hint: string;
  toolPrefix: string;
};

export type SessionPolicy = {
  roles: Role[];
  targets: Record<Role, number>;
  heartbeat: boolean;
  intent: Intent;
  mcpProviders: string[];
  mcpHints: string[];
  staleSensitive: boolean;
  allowDeepMcp: boolean;
  mcpCallCount: number;
  mcpTouched: Record<string, number>;
  mcpWarnings: string[];
};

export type McpBlockResult = {
  blocked: boolean;
  warning?: string;
};

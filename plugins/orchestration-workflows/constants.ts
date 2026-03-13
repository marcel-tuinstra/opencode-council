import type { Intent, Role } from "./types";

export const TURN_COUNTS = {
  default: { 2: 8, 3: 10, 4: 12, 5: 12, max: 14 },
  backend: { 2: 8, 3: 10, 4: 10, max: 12 },
  marketing: { 2: 10, 3: 10, max: 12 }
} as const;

export const DEFAULT_ROLE_ALIASES: Record<string, Role> = {
  cto: "CTO",
  dev: "DEV",
  developer: "DEV",
  po: "PO",
  pm: "PM",
  ceo: "CEO",
  marketing: "MARKETING",
  research: "RESEARCH"
};

export const MENTION_REGEX = /@([A-Za-z][A-Za-z0-9_-]*)/g;
export const MARKER_REGEX = /<<ORCHESTRATION_WORKFLOWS:([^>]+)>>/;
export const MARKER_REMOVAL_REGEX = /\n*<<ORCHESTRATION_WORKFLOWS:[^>]+>>/g;
export const MARKER_PREFIX = "<<ORCHESTRATION_WORKFLOWS:";
export const MARKER_SUFFIX = ">>";

export const STALE_SENSITIVE_REGEX =
  /\b(current|latest|today|this week|this month|recent|live|regression|incident|status|right now|fresh|up-to-date)\b/i;

export const DEEP_MCP_REGEX =
  /\b(deeper|deep dive|thorough|comprehensive|full investigation|as needed|as much as needed|exhaustive)\b/i;

export const INTENT_KEYWORDS: Record<Intent, RegExp[]> = {
  backend: [
    /api|latency|database|db|cache|query|service|backend|throughput|p95|p99|infra|performance/i,
    /timeout|retry|index|n\+1|scaling|server|endpoint|queue/i
  ],
  design: [
    /design|ux|ui|prototype|wireframe|usability|interaction|layout|visual|figma/i,
    /experience|journey|information architecture|a11y|accessibility/i
  ],
  marketing: [
    /marketing|positioning|messaging|campaign|launch|brand|audience|copy|narrative/i,
    /go-to-market|gtm|webinar|case study|ad|funnel|conversion/i
  ],
  roadmap: [
    /roadmap|milestone|quarter|timeline|deadline|planning|refinement|delivery|scope/i,
    /prioritization|dependency|release|backlog|estimate|resourcing/i
  ],
  research: [
    /research|interview|evidence|hypothesis|experiment|validate|confidence|survey/i,
    /competitive|benchmark|discovery|analysis|findings|insight/i
  ],
  mixed: []
};

export const INTENT_ROLE_WEIGHTS: Record<Intent, Record<Role, number>> = {
  backend: {
    CTO: 5,
    DEV: 5,
    PM: 2,
    PO: 2,
    CEO: 1,
    MARKETING: 0,
    RESEARCH: 1
  },
  design: {
    CTO: 2,
    DEV: 2,
    PM: 4,
    PO: 4,
    CEO: 1,
    MARKETING: 3,
    RESEARCH: 3
  },
  marketing: {
    CTO: 1,
    DEV: 1,
    PM: 2,
    PO: 2,
    CEO: 4,
    MARKETING: 5,
    RESEARCH: 2
  },
  roadmap: {
    CTO: 3,
    DEV: 2,
    PM: 5,
    PO: 5,
    CEO: 4,
    MARKETING: 2,
    RESEARCH: 2
  },
  research: {
    CTO: 3,
    DEV: 3,
    PM: 2,
    PO: 2,
    CEO: 1,
    MARKETING: 1,
    RESEARCH: 5
  },
  mixed: {
    CTO: 2,
    DEV: 2,
    PM: 2,
    PO: 2,
    CEO: 2,
    MARKETING: 2,
    RESEARCH: 2
  }
};

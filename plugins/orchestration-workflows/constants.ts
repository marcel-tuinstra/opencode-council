import type { Intent, Role } from "./types";

export const TURN_COUNTS = {
  default: { 2: 8, 3: 10, 4: 12, 5: 12, max: 14 },
  frontend: { 2: 8, 3: 10, 4: 10, max: 12 },
  backend: { 2: 8, 3: 10, 4: 10, max: 12 },
  marketing: { 2: 10, 3: 10, max: 12 }
} as const;

export const DEFAULT_ROLE_ALIASES: Record<string, Role> = {
  cto: "CTO",
  dev: "DEV",
  developer: "DEV",
  engineer: "DEV",
  fullstack: "DEV",
  "full-stack": "DEV",
  "full-stack-dev": "DEV",
  fe: "FE",
  frontend: "FE",
  "frontend-dev": "FE",
  be: "BE",
  backend: "BE",
  "backend-dev": "BE",
  ux: "UX",
  ui: "UX",
  "ui-ux": "UX",
  uiux: "UX",
  "ui-ux-reviewer": "UX",
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

export const DELEGATION_PATTERNS = [
  /\blet\s+@([A-Za-z][A-Za-z0-9_-]*)\s+delegate\b/i,
  /\bhave\s+@([A-Za-z][A-Za-z0-9_-]*)\s+(?:decide|choose)\b/i,
  /\buse\s+@([A-Za-z][A-Za-z0-9_-]*)\s+first\b[\s\S]{0,120}?\blet\s+(?:it|them|@([A-Za-z][A-Za-z0-9_-]*))\s+(?:pull\s+in|bring\s+in|involve|delegate)\b/i
] as const;

export const STALE_SENSITIVE_REGEX =
  /\b(current|latest|today|this week|this month|recent|live|regression|incident|status|right now|fresh|up-to-date)\b/i;

export const DEEP_MCP_REGEX =
  /\b(deeper|deep dive|thorough|comprehensive|full investigation|as needed|as much as needed|exhaustive)\b/i;

export const INTENT_KEYWORDS: Record<Intent, RegExp[]> = {
  frontend: [
    /frontend|front-end|component|responsive|layout|css|tailwind|animation|interaction|client-side/i,
    /react|vue|nuxt|next(?:\.js)|nextjs|tsx|jsx|state|hydration|storybook/i
  ],
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
  frontend: {
    CTO: 3,
    DEV: 3,
    FE: 5,
    BE: 1,
    UX: 4,
    PM: 2,
    PO: 3,
    CEO: 1,
    MARKETING: 1,
    RESEARCH: 1
  },
  backend: {
    CTO: 4,
    DEV: 3,
    FE: 0,
    BE: 5,
    UX: 0,
    PM: 2,
    PO: 2,
    CEO: 1,
    MARKETING: 0,
    RESEARCH: 1
  },
  design: {
    CTO: 2,
    DEV: 1,
    FE: 2,
    BE: 0,
    UX: 5,
    PM: 3,
    PO: 4,
    CEO: 1,
    MARKETING: 2,
    RESEARCH: 3
  },
  marketing: {
    CTO: 1,
    DEV: 1,
    FE: 1,
    BE: 0,
    UX: 1,
    PM: 2,
    PO: 2,
    CEO: 4,
    MARKETING: 5,
    RESEARCH: 2
  },
  roadmap: {
    CTO: 3,
    DEV: 2,
    FE: 1,
    BE: 1,
    UX: 1,
    PM: 5,
    PO: 5,
    CEO: 4,
    MARKETING: 2,
    RESEARCH: 2
  },
  research: {
    CTO: 3,
    DEV: 3,
    FE: 1,
    BE: 1,
    UX: 2,
    PM: 2,
    PO: 2,
    CEO: 1,
    MARKETING: 1,
    RESEARCH: 5
  },
  mixed: {
    CTO: 2,
    DEV: 3,
    FE: 2,
    BE: 2,
    UX: 2,
    PM: 2,
    PO: 2,
    CEO: 2,
    MARKETING: 2,
    RESEARCH: 2
  }
};

export const MAX_PARALLEL_AGENTS_REGEX = /\bmax\s+parallel\s+agents?\s+(\d+)\b/i;

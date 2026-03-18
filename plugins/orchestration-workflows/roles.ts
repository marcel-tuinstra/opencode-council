import {
  DELEGATION_PATTERNS,
  MARKER_REGEX,
  MENTION_REGEX
} from "./constants";
import { getSupervisorPolicy } from "./supervisor-config";
import { SUPPORTED_ROLES } from "./types";
import type { DelegationRequest, Role } from "./types";

export const isSupportedRole = (role: string): role is Role => {
  return SUPPORTED_ROLES.includes(role as Role);
};

const replaceWithSpaces = (value: string) => " ".repeat(value.length);

const stripCodeSegments = (text: string) => {
  return text
    .replace(/```[\s\S]*?```/g, (segment) => replaceWithSpaces(segment))
    .replace(/`[^`]*`/g, (segment) => replaceWithSpaces(segment));
};

export const normalizeRole = (raw: string): Role | null => {
  const lowered = raw.toLowerCase();
  const roleAliases = getSupervisorPolicy().roleAliases;
  if (roleAliases[lowered]) {
    return roleAliases[lowered];
  }

  const upper = raw.toUpperCase();
  return isSupportedRole(upper) ? upper : null;
};

export const detectRolesFromMentions = (text: string): Role[] => {
  const sanitizedText = stripCodeSegments(text);
  const detected = new Set<Role>();

  for (const match of sanitizedText.matchAll(MENTION_REGEX)) {
    const fullMatch = match[0];
    const mentionStart = match.index ?? -1;
    const mentionEnd = mentionStart + fullMatch.length;
    const nextChar = mentionEnd >= 0 ? (sanitizedText[mentionEnd] ?? "") : "";
    const charAfterNext = mentionEnd + 1 >= 0 ? (sanitizedText[mentionEnd + 1] ?? "") : "";
    const prevChar = mentionStart > 0 ? (sanitizedText[mentionStart - 1] ?? "") : "";

    if (prevChar && /[A-Za-z0-9_./\\-]/.test(prevChar)) {
      continue;
    }

    const looksLikePath = nextChar === "/" || nextChar === "\\";
    const looksLikeExtension = nextChar === "." && /[A-Za-z0-9_-]/.test(charAfterNext);
    if (looksLikePath || looksLikeExtension) {
      continue;
    }

    const role = normalizeRole(match[1]);
    if (role) {
      detected.add(role);
    }
  }

  return Array.from(detected);
};

export const parseRolesFromMarker = (text: string): Role[] | null => {
  const match = text.match(MARKER_REGEX);
  if (!match) {
    return null;
  }

  const roles = match[1]
    .split(",")
    .map((role) => role.trim())
    .map((role) => normalizeRole(role))
    .filter((role): role is Role => role !== null);

  return roles.length > 0 ? roles : null;
};

export const detectRolesFromText = (text: string): Role[] | null => {
  const markerRoles = parseRolesFromMarker(text);
  if (markerRoles && markerRoles.length > 0) {
    return markerRoles;
  }

  const mentionRoles = detectRolesFromMentions(text);
  return mentionRoles.length > 0 ? mentionRoles : null;
};

const toDelegationRequest = (primaryRole: Role, requestedByUser: Role[]): DelegationRequest => ({
  mode: "agent-led",
  primaryRole,
  requestedByUser
});

export const detectDelegationRequest = (text: string): DelegationRequest | null => {
  const requestedByUser = detectRolesFromMentions(text);
  if (requestedByUser.length === 0) {
    return null;
  }

  const sanitizedText = stripCodeSegments(text);
  for (const pattern of DELEGATION_PATTERNS) {
    const match = sanitizedText.match(pattern);
    const candidate = match?.[1] ?? match?.[2];
    if (!candidate) {
      continue;
    }

    const primaryRole = normalizeRole(candidate);
    if (primaryRole && requestedByUser.includes(primaryRole)) {
      return toDelegationRequest(primaryRole, requestedByUser);
    }
  }

  return null;
};

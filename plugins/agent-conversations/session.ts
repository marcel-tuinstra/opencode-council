import type { SessionPolicy } from "./types";

export const sessionPolicy = new Map<string, SessionPolicy>();
export const systemInjectedForSession = new Set<string>();

export const resetSessionState = (sessionID: string) => {
  sessionPolicy.delete(sessionID);
  systemInjectedForSession.delete(sessionID);
};

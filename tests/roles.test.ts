import { describe, expect, it } from "vitest";
import {
  detectRolesFromMentions,
  detectRolesFromText,
  normalizeRole,
  parseRolesFromMarker
} from "../plugins/orchestration-workflows/roles";

describe("roles", () => {
  it("normalizes role aliases", () => {
    expect(normalizeRole("developer")).toBe("DEV");
    expect(normalizeRole("cto")).toBe("CTO");
    expect(normalizeRole("unknown")).toBeNull();
  });

  it("detects supported mentions", () => {
    expect(detectRolesFromMentions("@cto @dev @pm")).toEqual(["CTO", "DEV", "PM"]);
  });

  it("ignores file references", () => {
    expect(detectRolesFromMentions("Read @INSTALL.md and @README.md then @dev review")).toEqual(["DEV"]);
  });

  it("ignores mentions inside code segments", () => {
    const text = "Use `@cto` first.```ts\nconst x='@dev'\n``` then ask @pm.";
    expect(detectRolesFromMentions(text)).toEqual(["PM"]);
  });

  it("parses marker roles", () => {
    expect(parseRolesFromMarker("hello <<ORCHESTRATION_WORKFLOWS:CTO,DEV,PM>>")).toEqual(["CTO", "DEV", "PM"]);
  });

  it("prefers marker roles over mentions", () => {
    const text = "@ceo <<ORCHESTRATION_WORKFLOWS:CTO,DEV>> @pm";
    expect(detectRolesFromText(text)).toEqual(["CTO", "DEV"]);
  });
});

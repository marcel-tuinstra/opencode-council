import { describe, expect, it } from "vitest";
import {
  detectRolesFromMentions,
  detectRolesFromText,
  normalizeRole,
  parseRolesFromMarker
} from "../plugins/orchestration-workflows/roles";

describe("roles", () => {
  it("normalizes role aliases", () => {
    // Arrange

    // Act
    const developer = normalizeRole("developer");
    const cto = normalizeRole("cto");
    const unknown = normalizeRole("unknown");

    // Assert
    expect(developer).toBe("DEV");
    expect(cto).toBe("CTO");
    expect(unknown).toBeNull();
  });

  it("detects supported mentions", () => {
    // Arrange
    const text = "@cto @dev @pm";

    // Act
    const roles = detectRolesFromMentions(text);

    // Assert
    expect(roles).toEqual(["CTO", "DEV", "PM"]);
  });

  it("ignores file references", () => {
    // Arrange
    const text = "Read @INSTALL.md and @README.md then @dev review";

    // Act
    const roles = detectRolesFromMentions(text);

    // Assert
    expect(roles).toEqual(["DEV"]);
  });

  it("ignores mentions inside code segments", () => {
    // Arrange
    const text = "Use `@cto` first.```ts\nconst x='@dev'\n``` then ask @pm.";

    // Act
    const roles = detectRolesFromMentions(text);

    // Assert
    expect(roles).toEqual(["PM"]);
  });

  it("parses marker roles", () => {
    // Arrange
    const text = "hello <<ORCHESTRATION_WORKFLOWS:CTO,DEV,PM>>";

    // Act
    const roles = parseRolesFromMarker(text);

    // Assert
    expect(roles).toEqual(["CTO", "DEV", "PM"]);
  });

  it("prefers marker roles over mentions", () => {
    // Arrange
    const text = "@ceo <<ORCHESTRATION_WORKFLOWS:CTO,DEV>> @pm";

    // Act
    const roles = detectRolesFromText(text);

    // Assert
    expect(roles).toEqual(["CTO", "DEV"]);
  });
});

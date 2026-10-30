import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween } from "./dates";

describe("addMonths", () => {
  it("adds months", () => expect(addMonths("2026-03-15", 12)).toBe("2027-03-15"));
  it("clamps to the end of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("crosses year ends", () => expect(addMonths("2026-11-30", 3)).toBe("2027-02-28"));
});

describe("addDays and daysBetween", () => {
  it("adds days across a BST change without drifting", () =>
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"));
  it("counts days both ways", () => {
    expect(daysBetween("2026-10-30", "2026-11-29")).toBe(30);
    expect(daysBetween("2026-10-30", "2026-10-20")).toBe(-10);
  });
});

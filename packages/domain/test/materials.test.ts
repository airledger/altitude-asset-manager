import { describe, expect, it } from "vitest";
import { materialsForJob } from "../src";

const units = [
  { id: "u1", role: "indoor", indoorType: "Wall mounted" },
  { id: "u2", role: "outdoor" },
];
const materials = [
  { id: "m1", name: "Coil cleaner", appliesTo: "indoor", qtyPer: 1, when: "service" },
  { id: "m2", name: "Pipe insulation (per m)", appliesTo: "indoor", qtyPer: 10, when: "install" },
  { id: "m3", name: "Wall bracket", appliesTo: "outdoor", qtyPer: 1, when: "install" },
];
const info = { fgas: { required: false, months: 0 }, nextLeakCheck: null } as never;
const names = (type: string) =>
  materialsForJob({ id: "j", type, date: "2026-11-15" }, units, info, materials, "2026-11-15").map(
    (l) => `${l.qty} × ${l.name}`,
  );

describe("install kit", () => {
  it("goes on installation jobs only", () => {
    expect(names("Installation")).toEqual(["10 × Pipe insulation (per m)", "1 × Wall bracket"]);
    expect(names("Commissioning")).toEqual(["10 × Pipe insulation (per m)", "1 × Wall bracket"]);
    expect(names("Annual service")).toEqual(["1 × Coil cleaner"]);
  });
});

import { describe, expect, it } from "vitest";
import { aggregateOrder, countFor, materialsForJob } from "./materials";
import { fgas } from "./fgas";
import type { Unit } from "./types";

const units: Unit[] = [
  { id: "AC-1", role: "outdoor" },
  { id: "AC-2", role: "indoor", indoorType: "Wall mounted", filterType: "Replaceable", condensatePump: true },
  { id: "AC-3", role: "indoor", indoorType: "Cassette", controller: "Wired controller" },
  { id: "AC-4", role: "indoor", indoorType: "Wall mounted" },
];
const noLeak = { fgas: fgas({ refrigerant: "R32", factoryChargeKg: 1 }), nextLeakCheck: null };

describe("countFor", () => {
  it.each([
    ["visit", 1],
    ["indoor", 3],
    ["outdoor", 1],
    ["wall", 2],
    ["cassette", 1],
    ["pump", 1],
    ["filter", 1],
    ["remote", 2], // a blank controller counts as a wireless remote
    ["unknown", 0],
  ])("%s → %i", (appliesTo, n) => expect(countFor(appliesTo, units)).toBe(n));
});

describe("materialsForJob", () => {
  const job = { id: "j", type: "Annual service", date: "2026-11-02" };

  it("rounds quantities up without floating-point drift", () => {
    const many = Array.from({ length: 30 }, (_, i): Unit => ({ id: `u${i}`, role: "indoor" }));
    const [line] = materialsForJob(
      job,
      many,
      noLeak,
      [{ id: "m", name: "Wipes", appliesTo: "indoor", qtyPer: 0.1 }],
      "2026-10-30",
    );
    expect(line?.qty).toBe(3); // 30 × 0.1 is 3.0000000000000004
  });

  it("only adds leak-check items when a leak check is due within a month of the job", () => {
    const mats = [{ id: "m", name: "Leak spray", when: "leak" }];
    const due = { fgas: fgas({ refrigerant: "R410A", factoryChargeKg: 3 }), nextLeakCheck: "2026-12-03" };
    expect(materialsForJob(job, units, due, mats, "2026-10-30")).toHaveLength(1);
    expect(
      materialsForJob(job, units, { ...due, nextLeakCheck: "2026-12-04" }, mats, "2026-10-30"),
    ).toHaveLength(0);
    expect(materialsForJob({ ...job, type: "Leak check" }, units, noLeak, mats, "2026-10-30")).toHaveLength(
      1,
    );
  });

  it("skips service items on other jobs, items the engineer picks, and items not in use", () => {
    const mats = [
      { id: "a", name: "Coil cleaner" },
      { id: "b", name: "Spare fuse", when: "pick" },
      { id: "c", name: "Old filter", when: "any", active: false },
      { id: "d", name: "Gloves", when: "any" },
    ];
    expect(
      materialsForJob({ ...job, type: "Repair / breakdown" }, units, noLeak, mats, "2026-10-30").map(
        (m) => m.id,
      ),
    ).toEqual(["d"]);
  });
});

it("adds up an order by supplier, then name", () => {
  const order = aggregateOrder([
    [{ id: "a", name: "Wipes", supplier: "Wolseley", qty: 1, raw: 0.4 }],
    [
      { id: "a", name: "Wipes", supplier: "Wolseley", qty: 1, raw: 0.4 },
      { id: "b", name: "Bags", supplier: "Climate Center", qty: 2, raw: 2 },
    ],
  ]);
  expect(order.map((m) => [m.name, m.qty])).toEqual([
    ["Bags", 2],
    ["Wipes", 1],
  ]);
});

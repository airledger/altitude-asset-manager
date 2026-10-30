import { describe, expect, it } from "vitest";
import { fgas } from "./fgas";

describe("fgas", () => {
  it("doesn't need leak checks under 5 t CO2e", () => {
    const f = fgas({ refrigerant: "R32", factoryChargeKg: 1.2 }); // 0.81 t
    expect(f.required).toBe(false);
    expect(f.months).toBe(0);
  });

  it("needs a yearly check from 5 t CO2e", () => {
    const f = fgas({ refrigerant: "R410A", factoryChargeKg: 2.4 }); // 5.01 t
    expect(f.tonnesCo2e).toBeCloseTo(5.0112);
    expect(f.months).toBe(12);
  });

  it("uses 10 t for hermetically sealed systems", () => {
    expect(fgas({ refrigerant: "R410A", factoryChargeKg: 2.4, hermetic: true }).required).toBe(false);
  });

  it("counts added charge", () => {
    expect(fgas({ refrigerant: "R32", factoryChargeKg: 5, addedChargeKg: 3 }).months).toBe(12); // 5.4 t
  });

  it("tightens to 6 and 3 months at 50 and 500 t", () => {
    expect(fgas({ refrigerant: "R410A", factoryChargeKg: 24 }).months).toBe(6);
    expect(fgas({ refrigerant: "R410A", factoryChargeKg: 240 }).months).toBe(3);
  });

  it("doubles the interval with automatic leak detection", () => {
    expect(fgas({ refrigerant: "R410A", factoryChargeKg: 24, leakDetection: true }).months).toBe(12);
  });

  it("uses the system's own GWP for other refrigerants", () => {
    const f = fgas({ refrigerant: "Other", gwp: 1000, factoryChargeKg: 5 });
    expect(f.gwp).toBe(1000);
    expect(f.months).toBe(12);
  });
});

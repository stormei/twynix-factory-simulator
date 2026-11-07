import { describe, it, expect } from "vitest";
import { Simulation } from "@twynix/simulation-core";
import { projectSchema } from "@twynix/shared-types";
import { validateProject } from "@twynix/process-graph";
import { solarDemo } from "../examples/solar-farm";

const steps = (s: Simulation, count: number) => {
  for (let i = 0; i < count; i++) s.step();
};
const value = (s: Simulation, id: string, key: string) =>
  Number(s.states[id].values[key]);
describe("solar farm energy model", () => {
  it("conserves DC/AC power through multiple rated inverters and integrates energy at 100 ms", () => {
    const s = new Simulation(projectSchema.parse(solarDemo));
    let energy = 0,
      exportEnergy = 0;
    for (let i = 0; i < 1200; i++) {
      s.step();
      const m = s.snapshot().solar!;
      expect(m.acPower).toBeLessThanOrEqual(350);
      expect(m.dcPower * 0.987).toBeCloseTo(m.acPower, 8);
      expect(m.exportPower).toBeCloseTo(m.acPower - 10, 8);
      energy += (m.acPower * 0.1) / 3600;
      exportEnergy += (Math.max(0, m.exportPower) * 0.1) / 3600;
      expect(m.energy).toBeCloseTo(energy, 9);
      expect(value(s, "grid", "ExportEnergy")).toBeCloseTo(exportEnergy, 9);
      for (let j = 1; j <= 3; j++) {
        expect(value(s, `pv${j}`, "DCPower")).toBeLessThanOrEqual(
          value(s, `pv${j}`, "AvailablePower") + 1e-8,
        );
        expect(
          value(s, `inv${j}`, "ACCurrent") * Math.sqrt(3) * 400,
        ).toBeCloseTo(value(s, `inv${j}`, "ACPower") * 1000, 6);
      }
    }
    expect(s.snapshot().solar?.online).toBe(3);
    expect(energy).toBeGreaterThan(8);
  });
  it("qualifies the grid before startup, clips and curtails each inverter independently", () => {
    const p = structuredClone(solarDemo);
    for (const e of p.equipment.filter((e) => e.type === "pv-array"))
      e.parameters["cloudDepth"] = 0;
    const s = new Simulation(p);
    steps(s, 99);
    expect(value(s, "inv1", "ACPower")).toBe(0);
    expect(s.states["inv1"].status).toBe("starting");
    steps(s, 100);
    expect(value(s, "inv1", "ACPower")).toBe(100);
    s.submit("inv1", "PowerLimitPercent", 40, "opcua");
    s.submit("inv1", "PowerLimitEnabled", true, "opcua");
    s.step();
    expect(value(s, "inv1", "ACPower")).toBe(40);
    expect(s.states["inv1"].status).toBe("limited");
    expect(value(s, "inv2", "ACPower")).toBeGreaterThan(100);
    s.submit("inv1", "RunCommand", false, "opcua");
    s.step();
    expect(value(s, "inv1", "ACPower")).toBe(0);
    expect(s.states["inv1"].status).toBe("off");
  });
  it("drops output immediately on grid loss and restarts with qualification; models nighttime import", () => {
    const s = new Simulation(solarDemo);
    steps(s, 250);
    expect(s.snapshot().solar!.acPower).toBeGreaterThan(200);
    s.submit("grid", "GridConnected", false, "ui");
    s.step();
    expect(s.snapshot().solar?.acPower).toBe(0);
    expect(s.snapshot().solar?.exportPower).toBe(0);
    expect(value(s, "inv1", "EventFlags") & (1 << 4)).not.toBe(0);
    s.submit("grid", "GridConnected", true, "ui");
    s.step();
    expect(s.states["inv1"].status).toBe("starting");
    for (const e of s.project.equipment.filter((e) => e.type === "pv-array"))
      s.submit(e.id, "IrradianceSetpoint", 0, "ui");
    s.step();
    expect(s.states["inv1"].status).toBe("sleeping");
    expect(s.snapshot().solar?.acPower).toBe(0);
    expect(s.snapshot().solar?.exportPower).toBe(-10);
    const before = value(s, "grid", "ImportEnergy");
    steps(s, 360);
    expect(value(s, "grid", "ImportEnergy") - before).toBeCloseTo(0.1, 8);
  });
  it("handles shading, thermal derating, trip and overheat faults with deterministic reset/replay", () => {
    const p = structuredClone(solarDemo);
    for (const e of p.equipment.filter((e) => e.type === "pv-array")) {
      e.commands["AmbientTemperature"] = 65;
      e.parameters["cloudDepth"] = 0;
    }
    const s = new Simulation(p);
    steps(s, 2000);
    expect(value(s, "inv1", "Temperature")).toBeGreaterThan(55);
    expect(value(s, "inv1", "ACPower")).toBeLessThan(100);
    const first = s.snapshot();
    s.reset();
    steps(s, 2000);
    expect(s.states).toEqual(first.states);
    expect(s.snapshot().solar).toEqual(first.solar);
    s.submit("pv1", "ShadingPercent", 100, "ui");
    s.step();
    expect(value(s, "inv1", "ACPower")).toBe(0);
    s.fault("inv2", "overheat", true);
    s.step();
    expect(s.states["inv2"].status).toBe("fault");
    expect(value(s, "inv2", "ACPower")).toBe(0);
    expect(value(s, "inv2", "EventFlags") & (1 << 7)).not.toBe(0);
    s.fault("inv3", "trip", true);
    s.step();
    expect(value(s, "inv3", "ACPower")).toBe(0);
    s.fault("inv3", "trip", false);
    s.step();
    expect(s.states["inv3"].status).toBe("starting");
  });
  it("rejects invalid solar parameters and AC/DC wiring mistakes", () => {
    const changes: [string, string, number][] = [
      ["inv1", "ratedPower", 101],
      ["inv1", "efficiency", 1.1],
      ["pv1", "cloudPeriod", 0],
      ["pv1", "cloudDepth", 1.1],
      ["pv1", "temperatureCoefficient", 1],
    ];
    for (const [id, key, val] of changes) {
      const p = structuredClone(solarDemo);
      p.equipment.find((e) => e.id === id)!.parameters[key] = val;
      expect(() => validateProject(p)).toThrow();
    }
    const p = structuredClone(solarDemo);
    p.connections = [
      { id: "bad", from: "pv1", fromPort: "out", to: "grid", toPort: "in1" },
    ];
    expect(() => validateProject(p)).toThrow(/Solar connections/);
    const disconnected = structuredClone(solarDemo);
    disconnected.connections = [];
    const s = new Simulation(disconnected);
    steps(s, 300);
    expect(s.snapshot().solar?.acPower).toBe(0);
  });
});

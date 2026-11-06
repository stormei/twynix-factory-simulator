import { describe, it, expect } from "vitest";
import { Simulation } from "@twynix/simulation-core";
import { projectSchema } from "@twynix/shared-types";
import { demo as baseDemo, equipment } from "../examples/water-treatment";
import { ProjectStore } from "../apps/server/src/storage";
const demo = structuredClone(baseDemo);
demo.equipment.find((e) => e.id === "pump")!.mode = "manual";
const run = (s: Simulation, n: number) => {
  for (let i = 0; i < n; i++) s.step();
};
describe("causal water process", () => {
  it("ramps feedback and fills the tank with measured flow", () => {
    const s = new Simulation(demo);
    s.submit("pump", "RunCommand", true, "ui");
    expect(s.states["pump"].values["RunFeedback"]).toBe(false);
    s.step();
    expect(s.states["pump"].values["ActualSpeed"]).toBeCloseTo(3.3333, 3);
    run(s, 199);
    expect(s.states["tank"].values["Volume"]).toBeGreaterThan(1800);
    expect(s.states["flow"].values["Measurement"]).toBeCloseTo(35, 0);
    expect(s.states["pump"].values["MotorCurrent"]).toBeGreaterThan(0);
  });
  it("drains with pump off and outlet open; trip removes pump flow", () => {
    const s = new Simulation(demo);
    s.submit("outlet", "OpenCommand", true, "ui");
    run(s, 100);
    expect(s.states["tank"].values["Volume"]).toBeLessThan(1250);
    s.submit("pump", "RunCommand", true, "ui");
    run(s, 50);
    expect(Number(s.states["tank"].values["Inflow"])).toBeGreaterThan(0);
    s.fault("pump", "trip", true);
    s.step();
    expect(s.states["tank"].values["Inflow"]).toBe(0);
    expect(s.states["pump"].values["RunFeedback"]).toBe(false);
    expect(() => s.submit("pump", "RunCommand", true, "ui")).toThrow(
      "interlock",
    );
  });
  it("contains volume at empty/full boundaries and emits alarms", () => {
    const p = structuredClone(demo);
    p.equipment.find((e) => e.id === "tank")!.parameters["initialVolume"] =
      4999;
    const s = new Simulation(p);
    s.submit("pump", "RunCommand", true, "ui");
    run(s, 500);
    expect(s.states["tank"].values["Volume"]).toBe(5000);
    expect(s.states["tank"].values["HighLevelAlarm"]).toBe(true);
    s.submit("pump", "RunCommand", false, "ui");
    s.submit("outlet", "OpenCommand", true, "ui");
    run(s, 10000);
    expect(Number(s.states["tank"].values["Volume"])).toBeGreaterThanOrEqual(0);
    expect(s.states["tank"].values["LowLevelAlarm"]).toBe(true);
  });
  it("is repeatable with seeded noise and cyclic graph", () => {
    const p = structuredClone(demo);
    p.connections = p.connections.filter((c) => c.id !== "c1");
    p.connections.push({
      id: "loop",
      from: "outlet",
      fromPort: "out",
      to: "pump",
      toPort: "in",
    });
    const a = new Simulation(p),
      b = new Simulation(p);
    a.submit("pump", "RunCommand", true, "ui");
    b.submit("pump", "RunCommand", true, "ui");
    run(a, 1000);
    run(b, 1000);
    expect(a.states).toEqual(b.states);
    expect(a.time).toBe(100);
  });
  it("conserves fluid volume in a tank recirculation loop", () => {
    const p = structuredClone(demo);
    p.connections = p.connections.filter((c) => c.id !== "c1");
    p.connections.push({
      id: "recirculation",
      from: "outlet",
      fromPort: "out",
      to: "pump",
      toPort: "in",
    });
    const s = new Simulation(p);
    s.submit("pump", "RunCommand", true, "ui");
    s.submit("outlet", "OpenCommand", true, "ui");
    run(s, 1000);
    expect(s.states["tank"].values["Volume"]).toBe(1250);
    expect(Number(s.states["tank"].values["Inflow"])).toBeGreaterThan(0);
    expect(s.states["tank"].values["Inflow"]).toBe(
      s.states["tank"].values["Outflow"],
    );
  });
  it("pauses, resumes, resets, and pauses explicitly on overload", () => {
    const s = new Simulation(demo);
    s.control("start");
    s.advance(0.25);
    expect(s.time).toBe(0.2);
    s.control("pause");
    s.advance(1);
    expect(s.time).toBe(0.2);
    s.control("start");
    s.advance(0.1);
    expect(s.time).toBe(0.3);
    s.advance(10);
    expect(s.status).toBe("paused");
    expect(s.time).toBe(0.3);
    s.control("reset");
    expect(s.time).toBe(0);
    expect(s.states["tank"].values["Volume"]).toBe(1250);
  });
  it("uses server-side controller hysteresis and respects mode ownership", () => {
    const p = structuredClone(demo);
    p.equipment.find((e) => e.id === "pump")!.mode = "automatic";
    const s = new Simulation(p);
    s.step();
    expect(
      s.project.equipment.find((e) => e.id === "pump")!.commands["RunCommand"],
    ).toBe(true);
    run(s, 9000);
    expect(Number(s.states["tank"].values["Level"])).toBeGreaterThan(80);
    expect(
      s.project.equipment.find((e) => e.id === "pump")!.commands["RunCommand"],
    ).toBe(false);
    expect(() => s.submit("pump", "RunCommand", true, "opcua")).toThrow("mode");
    expect(() => s.submit("pump", "RunCommand", true, "ui")).toThrow("mode");
  });
  it("models valve delay, bad quality and stuck measurements", () => {
    const p = structuredClone(demo);
    p.equipment.find((e) => e.id === "outlet")!.parameters["delay"] = 1;
    const s = new Simulation(p);
    s.submit("outlet", "OpenCommand", true, "ui");
    run(s, 5);
    expect(s.states["outlet"].values["Position"]).toBe(0);
    run(s, 30);
    expect(s.states["outlet"].values["Position"]).toBe(100);
    run(s, 30);
    s.fault("level", "stuck", true);
    const v = s.states["level"].values["Measurement"];
    run(s, 20);
    expect(s.states["level"].values["Measurement"]).toBe(v);
    expect(s.states["level"].quality).toBe("Uncertain");
    s.fault("level", "invalid", true);
    s.step();
    expect(s.states["level"].quality).toBe("Bad");
  });
  it("rejects bad types, connections, duplicate identities and unknown schema versions", () => {
    expect(() => projectSchema.parse({ ...demo, schemaVersion: 99 })).toThrow();
    const p = structuredClone(demo);
    p.connections[0].toPort = "bogus";
    expect(() => new Simulation(p)).toThrow("ports");
    const q = structuredClone(demo);
    q.equipment[0].id = q.equipment[1].id;
    expect(() => new Simulation(q)).toThrow("unique");
    const s = new Simulation(demo);
    expect(() => s.submit("pump", "SpeedSetpoint", 101, "ui")).toThrow("range");
    expect(() => s.submit("tank", "Volume", 42, "ui")).toThrow("read-only");
  });
  it("runs manufacturing drives without creating phantom products", () => {
    const p = structuredClone(demo);
    p.equipment = [
      equipment("belt", "conveyor", "CV-1", 0, 0, {}, { RunCommand: true }),
      equipment("m", "machine", "M-1", 200, 0, {}, { RunCommand: true }),
    ];
    p.connections = [];
    p.controllers = [];
    const s = new Simulation(p);
    run(s, 200);
    expect(s.states["belt"].values["RunFeedback"]).toBe(true);
    expect(s.states["belt"].values["ProductCount"]).toBe(0);
    expect(s.states["m"].status).toBe("starved");
    s.fault("belt", "jam", true);
    run(s, 20);
    expect(s.states["belt"].values["JamActive"]).toBe(true);
  });
  it("persists project definitions without physical runtime or sessions", () => {
    const store = new ProjectStore(":memory:");
    store.save(demo);
    const copy = store.get(demo.id);
    expect(copy).toEqual(demo);
    expect(store.list()).toHaveLength(1);
    store.save({ ...demo, name: "Renamed" });
    expect(store.get(demo.id).name).toBe("Renamed");
    store.delete(demo.id);
    expect(store.list()).toEqual([]);
    store.close();
  });
});

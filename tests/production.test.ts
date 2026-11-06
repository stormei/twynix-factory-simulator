import { describe, it, expect } from "vitest";
import { Simulation } from "@twynix/simulation-core";
import { runExperiments } from "../packages/simulation-core/src/experiments";
import { productionDemo } from "../examples/production-line";
import { ProjectStore } from "../apps/server/src/storage";
import { validateProject } from "@twynix/process-graph";
import type { ExperimentReport } from "@twynix/shared-types";
const steps = (s: Simulation, n: number) => {
  for (let i = 0; i < n; i++) s.step();
};
describe("connected material flow", () => {
  it("creates, transports, processes and inspects distinct products without loss", () => {
    const s = new Simulation(productionDemo);
    for (let i = 0; i < 1600; i++) {
      s.step();
      const m = s.snapshot().production!;
      expect(m.generated).toBe(m.completed + m.rejected + m.wip);
      const ids = Object.values(s.states).flatMap(
        (state) => state.products?.map((p) => p.id) ?? [],
      );
      expect(new Set(ids).size).toBe(ids.length);
      for (const station of m.stations)
        expect(station.occupancy).toBeLessThanOrEqual(station.capacity);
    }
    const m = s.snapshot().production!;
    expect(m.completed).toBeGreaterThan(30);
    expect(m.averageCycleTime).toBeGreaterThan(7);
    expect(m.bottleneck?.id).toBe("machine");
    expect(m.throughputPerHour).toBeCloseTo((m.completed / 160) * 3600);
    expect(
      Number(s.states["machine"].values["ProductCount"]),
    ).toBeGreaterThanOrEqual(m.completed + m.rejected);
  });
  it("cannot manufacture output from disconnected machines or a stopped feeder", () => {
    const p = structuredClone(productionDemo);
    p.equipment.find((e) => e.id === "feeder")!.commands["RunCommand"] = false;
    const s = new Simulation(p);
    steps(s, 500);
    expect(s.snapshot().production?.generated).toBe(0);
    expect(s.states["machine"].values["ProductCount"]).toBe(0);
    expect(s.states["machine"].status).toBe("starved");
    expect(s.states["inspection"].status).toBe("starved");
  });
  it("propagates downstream blockage and resumes without losing products", () => {
    const s = new Simulation(productionDemo);
    s.fault("inspection", "jam", true);
    steps(s, 1000);
    expect(s.states["machine"].status).toBe("blocked");
    expect(s.states["buffer"].values["QueueLength"]).toBe(4);
    expect(s.states["feeder"].status).toBe("blocked");
    expect(s.snapshot().production?.completed).toBe(0);
    s.fault("inspection", "jam", false);
    steps(s, 1000);
    expect(s.snapshot().production!.completed).toBeGreaterThan(10);
    const m = s.snapshot().production!;
    expect(m.generated).toBe(m.completed + m.rejected + m.wip);
  });
  it("starves downstream stations when a conveyor jams and freezes belt products", () => {
    const s = new Simulation(productionDemo);
    steps(s, 100);
    s.fault("conveyor", "jam", true);
    s.step();
    const positions = structuredClone(s.states["conveyor"].products);
    steps(s, 20);
    expect(s.states["conveyor"].products).toEqual(positions);
    steps(s, 600);
    expect(s.states["machine"].status).toBe("starved");
    expect(s.states["inspection"].status).toBe("starved");
    expect(s.snapshot().production!.downtimeSeconds).toBeGreaterThan(60);
  });
  it("inspection rejection is seeded, physical, and accounted separately", () => {
    const p = structuredClone(productionDemo);
    p.equipment.find((e) => e.id === "inspection")!.parameters["rejectRate"] =
      1;
    const a = new Simulation(p),
      b = new Simulation(p);
    steps(a, 700);
    steps(b, 700);
    expect(a.states).toEqual(b.states);
    expect(a.snapshot().production).toEqual(b.snapshot().production);
    expect(a.snapshot().production?.completed).toBe(0);
    expect(a.snapshot().production!.rejected).toBeGreaterThan(5);
    expect(a.states["finished"].values["RejectCount"]).toBe(
      a.snapshot().production?.rejected,
    );
    a.reset();
    expect(a.snapshot().production?.wip).toBe(0);
    expect(a.snapshot().production?.generated).toBe(0);
  });
  it("replays fault schedules exactly, tracks downtime and restores initial conditions", () => {
    const p = structuredClone(productionDemo);
    p.scenarios = [
      { at: 10, equipmentId: "machine", fault: "trip", active: true },
      { at: 25, equipmentId: "machine", fault: "trip", active: false },
    ];
    const s = new Simulation(p);
    steps(s, 400);
    expect(
      s.snapshot().production!.stations.find((x) => x.id === "machine")!
        .faultSeconds,
    ).toBeCloseTo(15);
    expect(s.events.filter((e) => e.message.includes("trip"))).toHaveLength(2);
    const baseline = s.snapshot().production;
    s.reset();
    steps(s, 400);
    expect(s.snapshot().production).toEqual(baseline);
  });
  it("validates buffer capacity and rejects invalid inspection settings", () => {
    const p = structuredClone(productionDemo);
    p.equipment.find((e) => e.id === "buffer")!.parameters["capacity"] = 1.5;
    expect(() => validateProject(p)).toThrow("integer");
    p.equipment.find((e) => e.id === "buffer")!.parameters["capacity"] = 4;
    p.equipment.find((e) => e.id === "inspection")!.parameters["rejectRate"] =
      2;
    expect(() => validateProject(p)).toThrow("Reject rate");
  });
  it("compares isolated configurations reproducibly without touching the live project", async () => {
    const input = {
      duration: 120,
      variants: [
        { name: "Baseline", overrides: [] },
        {
          name: "Faster processing",
          overrides: [
            { equipmentId: "machine", parameter: "cycleTime", value: 2 },
          ],
        },
      ],
    };
    const before = structuredClone(productionDemo);
    let yields = 0;
    const a = await runExperiments(productionDemo, input, async () => {
      yields++;
    });
    const b = await runExperiments(productionDemo, input);
    expect(a).toEqual(b);
    expect(productionDemo).toEqual(before);
    expect(yields).toBeGreaterThan(0);
    expect(a[1].metrics.completed).toBeGreaterThan(a[0].metrics.completed);
    const store = new ProjectStore(":memory:");
    const report: ExperimentReport = {
      id: "test-run",
      project: productionDemo,
      createdAt: new Date().toISOString(),
      duration: 120,
      results: a,
    };
    store.saveExperiment(report);
    expect(store.experiments(productionDemo.id)).toEqual([report]);
    store.close();
    await expect(
      runExperiments(productionDemo, {
        duration: 120,
        variants: [
          {
            name: "Invalid",
            overrides: [
              { equipmentId: "buffer", parameter: "capacity", value: 0 },
            ],
          },
        ],
      }),
    ).rejects.toThrow("positive");
  });
});

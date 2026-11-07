import type {
  Project,
  Snapshot,
  RuntimeEvent,
  EquipmentState,
  Value,
} from "@twynix/shared-types";
import {
  definitions,
  initial,
  actuator,
  clamp,
} from "@twynix/equipment-models";
import { validateProject, fluidPaths } from "@twynix/process-graph";
import { command, evaluateControllers } from "@twynix/control-engine";
import { applyScenarios } from "@twynix/scenario-engine";
import { MaterialRuntime } from "./material";
import { stepSolar, solarMetrics } from "./solar";
import { weatherAt } from "./weather";
export class Simulation {
  private material!: MaterialRuntime;
  readonly dt = 0.1;
  sourceTimestamp = new Date();
  project: Project;
  private baseline: Project;
  status: Snapshot["status"] = "stopped";
  time = 0;
  speed = 1;
  revision = 0;
  states: Record<string, EquipmentState> = {};
  events: RuntimeEvent[] = [];
  private seq = 0;
  private seed = 1;
  private history = new Map<string, number[]>();
  private accumulator = 0;
  opcua: Snapshot["opcua"] = {
    endpoint: "",
    sessions: 0,
    running: false,
    secure: true,
  };
  constructor(p: Project) {
    validateProject(p);
    this.project = structuredClone(p);
    this.baseline = structuredClone(p);
    this.reset();
  }
  random = (): number => {
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };
  event(message: string, severity: RuntimeEvent["severity"] = "info"): void {
    this.events.push({ seq: ++this.seq, time: this.time, severity, message });
    if (this.events.length > 200) this.events.shift();
  }
  replace(p: Project): void {
    validateProject(p);
    if (this.status === "running")
      throw Error("Pause the simulation before editing");
    this.project = structuredClone(p);
    this.baseline = structuredClone(p);
    this.reset();
    this.revision++;
  }
  reset(): void {
    this.revision++;
    this.sourceTimestamp = new Date();
    this.project = structuredClone(this.baseline);
    this.states = {};
    this.material = new MaterialRuntime(this.project);
    this.time = 0;
    this.seed = this.project.seed;
    this.history.clear();
    this.accumulator = 0;
    this.status = "stopped";
    for (const e of this.project.equipment) this.states[e.id] = initial(e);
    this.event("Initial conditions restored");
  }
  control(action: "start" | "pause" | "stop" | "reset", speed?: number): void {
    if (speed !== undefined) {
      if (!Number.isFinite(speed) || speed < 0.1 || speed > 20)
        throw Error("Speed must be 0.1–20");
      this.speed = speed;
    }
    if (action === "reset") this.reset();
    else {
      this.status =
        action === "start"
          ? "running"
          : action === "pause"
            ? "paused"
            : "stopped";
      this.accumulator = 0;
      this.event(`Simulation ${this.status}`);
    }
    this.revision++;
  }
  submit(id: string, tag: string, value: Value, source: "ui" | "opcua"): void {
    command(this.project, id, tag, value, source);
    this.revision++;
    this.sourceTimestamp = new Date();
    this.event(`${id}.${tag} accepted: ${value}`);
  }
  fault(
    id: string,
    fault: Project["equipment"][number]["faults"][number],
    active: boolean,
  ): void {
    const e = this.project.equipment.find((e) => e.id === id);
    if (!e) throw Error("Unknown equipment");
    e.faults = e.faults.filter((f) => f !== fault);
    if (active) e.faults.push(fault);
    this.revision++;
    this.event(
      `${e.tag}: ${fault} ${active ? "activated" : "cleared"}`,
      active ? "alarm" : "info",
    );
  }
  advance(wallSeconds: number): void {
    if (this.status !== "running") return;
    this.accumulator += wallSeconds * this.speed;
    if (this.accumulator > 5) {
      this.status = "paused";
      this.accumulator = 0;
      this.event(
        "Scheduler overload: paused; no process steps were skipped. Resume at a lower speed.",
        "alarm",
      );
      return;
    }
    let steps = 0;
    while (
      this.status === "running" &&
      this.accumulator + 1e-9 >= this.dt &&
      steps < 50
    ) {
      this.step();
      this.accumulator -= this.dt;
      steps++;
    }
  }
  step(): void {
    if (weatherAt(this.project, this.time)?.exhausted) {
      this.status = "paused";
      this.event(
        "Saved weather forecast ended. Load a new forecast or switch to manual weather.",
        "warning",
      );
      return;
    }
    const p = this.project;
    const c = { dt: this.dt, time: this.time, random: this.random };
    applyScenarios(p, this.time, this.dt, (m) => {
      this.event(m, "alarm");
      this.revision++;
    });
    evaluateControllers(p, this.states);
    const prev = this.states;
    const next: Record<string, EquipmentState> = {};
    const sorted = [...p.equipment].sort((a, b) => a.id.localeCompare(b.id));
    for (const e of sorted) next[e.id] = actuator(e, prev[e.id], c);
    const flowById = new Map<string, number>();
    const inFlow = new Map<string, number>();
    const outFlow = new Map<string, number>();
    for (const start of sorted.filter(
      (e) => e.type === "source" || e.type === "tank",
    )) {
      const path = fluidPaths(p, start.id);
      if (!path.length) continue;
      const end = p.equipment.find((e) => e.id === path.at(-1));
      let q =
        start.type === "source"
          ? (start.parameters["nominalFlow"] ?? 40)
          : 20 * Math.sqrt(Number(prev[start.id].values["Level"]) / 100);
      let restriction = 1;
      for (const id of path) {
        const e = p.equipment.find((e) => e.id === id)!;
        const v = next[id].values;
        if (e.type === "pump")
          q = Math.min(
            q,
            (e.parameters["nominalFlow"] * Number(v["ActualSpeed"])) / 100,
          );
        if (e.type === "valve")
          restriction *=
            Math.max(
              e.faults.includes("leak") ? 0.05 : 0,
              Number(v["Position"]) / 100,
            ) * e.parameters["coefficient"];
        if (e.type === "pipe") restriction *= e.parameters["coefficient"];
      }
      q *= clamp(restriction, 0, 1);
      if (start.type === "tank")
        q = Math.min(q, Number(prev[start.id].values["Volume"]) / this.dt);
      if (end?.type === "tank")
        q = Math.min(
          q,
          (end.parameters["capacity"] - Number(prev[end.id].values["Volume"])) /
            this.dt,
        );
      if (start.type === "tank") outFlow.set(start.id, q);
      if (end?.type === "tank") inFlow.set(end.id, q);
      flowById.set(start.id, q);
      for (const id of path)
        if (id !== end?.id || end.type !== "tank") flowById.set(id, q);
    }
    for (const e of sorted) {
      const s = next[e.id];
      const v = s.values;
      const params = e.parameters;
      if ("FlowRate" in v) v["FlowRate"] = flowById.get(e.id) ?? 0;
      if (e.type === "source" || e.type === "pipe")
        s.status = Number(v["FlowRate"]) > 0 ? "flowing" : "idle";
      if (e.type === "tank") {
        v["Inflow"] = inFlow.get(e.id) ?? 0;
        v["Outflow"] = outFlow.get(e.id) ?? 0;
        v["Volume"] = clamp(
          Number(prev[e.id].values["Volume"]) +
            (Number(v["Inflow"]) - Number(v["Outflow"])) * this.dt,
          0,
          params["capacity"],
        );
        v["Level"] = (Number(v["Volume"]) / params["capacity"]) * 100;
        v["HighLevelAlarm"] = Number(v["Level"]) >= params["high"];
        v["LowLevelAlarm"] = Number(v["Level"]) <= params["low"];
        s.status =
          v["HighLevelAlarm"] || v["LowLevelAlarm"] ? "alarm" : "normal";
        for (const alarm of ["HighLevelAlarm", "LowLevelAlarm"])
          if (v[alarm] !== prev[e.id].values[alarm])
            this.event(
              `${e.tag}: ${alarm} ${v[alarm] ? "active" : "cleared"}`,
              v[alarm] ? "alarm" : "info",
            );
      }
      if (e.type.includes("sensor")) {
        const link = p.connections.find((l) => l.to === e.id);
        const upstream = link ? next[link.from] : undefined;
        let measurement =
          e.type === "level-sensor"
            ? Number(upstream?.values["Level"] ?? 0)
            : e.type === "pressure-sensor"
              ? (flowById.get(e.id) ?? 0) * 0.1
              : e.type === "photo-sensor"
                ? Number(Boolean(upstream?.values["SensorActive"]))
                : (flowById.get(e.id) ?? 0);
        measurement +=
          (params["offset"] ?? 0) +
          (params["drift"] + (e.faults.includes("drift") ? 0.05 : 0)) *
            this.time +
          (this.random() - 0.5) * 2 * params["noise"];
        const queue = this.history.get(e.id) ?? [];
        queue.push(measurement);
        const delay = Math.min(600, Math.round(params["delay"] / this.dt));
        if (queue.length > delay) measurement = queue.shift()!;
        else measurement = Number(prev[e.id].values["Measurement"]);
        this.history.set(e.id, queue);
        if (e.faults.includes("stuck"))
          measurement = Number(prev[e.id].values["Measurement"]);
        const alpha =
          params["filter"] > 0 ? this.dt / (params["filter"] + this.dt) : 1;
        v["Measurement"] =
          Number(prev[e.id].values["Measurement"]) +
          alpha * (measurement - Number(prev[e.id].values["Measurement"]));
        s.quality = e.faults.includes("invalid")
          ? "Bad"
          : e.faults.includes("stuck")
            ? "Uncertain"
            : "Good";
        if (e.type === "photo-sensor")
          v["Detection"] = Number(v["Measurement"]) > 0.5;
        s.status = s.quality === "Good" ? "normal" : "fault";
      }
    }
    this.material.step(p, next, c);
    stepSolar(p, prev, next, c);
    this.states = next;
    this.sourceTimestamp = new Date();
    this.time = Math.round((this.time + this.dt) * 10) / 10;
  }
  productionMetrics() {
    return this.material.metrics(this.project, this.states, this.time);
  }
  solarMetrics() {
    return solarMetrics(this.project, this.states);
  }
  weatherConditions() {
    return weatherAt(this.project, this.time);
  }
  snapshot(): Snapshot {
    return {
      status: this.status,
      time: this.time,
      speed: this.speed,
      revision: this.revision,
      states: structuredClone(this.states),
      events: [...this.events],
      opcua: { ...this.opcua },
      production: this.productionMetrics(),
      solar: this.solarMetrics(),
      weather: this.weatherConditions(),
    };
  }
}

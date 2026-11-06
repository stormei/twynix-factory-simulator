import type {
  Project,
  Equipment,
  EquipmentState,
  SimulationContext,
  ProductionMetrics,
  StationMetrics,
} from "@twynix/shared-types";
interface Product {
  id: number;
  bornAt: number;
  progress: number;
  rejected: boolean;
  inspected: boolean;
}
interface Station {
  queue: Product[];
  clock: number;
  output: number;
  rejects: number;
  busy: number;
  starved: number;
  blocked: number;
  fault: number;
  stopped: number;
}
const types = new Set([
  "material-source",
  "conveyor",
  "buffer",
  "machine",
  "inspection",
  "sink",
  "counter",
]);
export const isMaterial = (e: Equipment) => types.has(e.type);
export function materialCapacity(e: Equipment): number {
  return e.type === "buffer"
    ? e.parameters["capacity"]
    : e.type === "conveyor"
      ? Math.max(1, Math.min(100, Math.floor(e.parameters["length"])))
      : e.type === "sink" || e.type === "counter"
        ? 100
        : 1;
}
/** Every product has one owner. Transfers are staged, so one token traverses at most one edge per step. */
export class MaterialRuntime {
  private stations = new Map<string, Station>();
  private serial = 0;
  private completed = 0;
  private rejected = 0;
  private totalLeadTime = 0;
  constructor(project: Project) {
    for (const e of project.equipment.filter(isMaterial))
      this.stations.set(e.id, {
        queue: [],
        clock: 0,
        output: 0,
        rejects: 0,
        busy: 0,
        starved: 0,
        blocked: 0,
        fault: 0,
        stopped: 0,
      });
  }
  step(
    project: Project,
    states: Record<string, EquipmentState>,
    c: SimulationContext,
  ): void {
    const equipment = project.equipment
      .filter(isMaterial)
      .sort((a, b) => a.id.localeCompare(b.id));
    const healthy = (e: Equipment) =>
      !e.faults.some((f) =>
        ["jam", "trip", "overheat", "fail-start"].includes(f),
      );
    const enabled = (e: Equipment) =>
      healthy(e) &&
      (e.type === "buffer" ||
        e.type === "sink" ||
        e.type === "counter" ||
        Boolean(e.commands["RunCommand"]));
    for (const e of equipment) {
      const station = this.stations.get(e.id)!;
      const state = states[e.id];
      const v = state.values;
      if (e.type === "material-source" && enabled(e)) {
        station.clock = Math.min(
          e.parameters["interval"],
          station.clock + c.dt,
        );
        if (
          station.clock + 1e-9 >= e.parameters["interval"] &&
          station.queue.length === 0
        ) {
          station.queue.push({
            id: ++this.serial,
            bornAt: c.time + c.dt,
            progress: 1,
            rejected: false,
            inspected: false,
          });
          station.clock = 0;
        }
      }
      if (enabled(e))
        for (const product of station.queue) {
          if (e.type === "buffer") {
            product.progress = 1;
            continue;
          }
          const speed = Number(v["ActualSpeed"] ?? 100) / 100;
          if (e.type === "conveyor")
            product.progress = Math.min(
              1,
              product.progress +
                (c.dt * e.parameters["speed"] * speed) / e.parameters["length"],
            );
          if (e.type === "machine" || e.type === "inspection")
            product.progress = Math.min(
              1,
              product.progress + (c.dt * speed) / e.parameters["cycleTime"],
            );
          if (
            e.type === "inspection" &&
            product.progress >= 1 - 1e-9 &&
            !product.inspected
          ) {
            product.progress = 1;
            product.inspected = true;
            product.rejected =
              product.rejected || c.random() < e.parameters["rejectRate"];
            if (product.rejected) station.rejects++;
          }
          if (product.progress >= 1 - 1e-9) product.progress = 1;
        }
    }
    for (const e of equipment)
      if (e.type === "conveyor") {
        const queue = this.stations.get(e.id)!.queue;
        for (let i = 1; i < queue.length; i++)
          queue[i].progress = Math.min(
            queue[i].progress,
            Math.max(0, queue[i - 1].progress - 1 / e.parameters["length"]),
          );
      }
    const moves: { from: Equipment; to: Equipment; product: Product }[] = [];
    const incoming = new Map<string, number>();
    const blocked = new Set<string>();
    for (const e of equipment) {
      const station = this.stations.get(e.id)!;
      const head = station.queue[0];
      if (!head || head.progress < 1 || !enabled(e)) continue;
      const link = project.connections.find(
        (l) => l.from === e.id && l.fromPort === "out",
      );
      const dest = link ? equipment.find((d) => d.id === link.to) : undefined;
      const target = dest ? this.stations.get(dest.id) : undefined;
      if (
        !dest ||
        !target ||
        !healthy(dest) ||
        target.queue.length + (incoming.get(dest.id) ?? 0) >=
          materialCapacity(dest)
      ) {
        blocked.add(e.id);
        continue;
      }
      moves.push({ from: e, to: dest, product: head });
      incoming.set(dest.id, (incoming.get(dest.id) ?? 0) + 1);
    }
    // Accounting uses the interval's operating state, before ownership changes at its end.
    for (const e of equipment) {
      const station = this.stations.get(e.id)!;
      const state = states[e.id];
      const v = state.values;
      const active = enabled(e);
      const head = station.queue[0];
      state.status = !healthy(e)
        ? e.faults.includes("jam")
          ? "jammed"
          : "fault"
        : !active
          ? "stopped"
          : blocked.has(e.id)
            ? "blocked"
            : e.type === "sink" || e.type === "counter"
              ? "collecting"
              : !head
                ? "starved"
                : e.type === "buffer"
                  ? "waiting"
                  : "running";
      if (state.status === "running") station.busy += c.dt;
      else if (state.status === "starved") station.starved += c.dt;
      else if (state.status === "blocked") station.blocked += c.dt;
      else if (state.status === "fault" || state.status === "jammed")
        station.fault += c.dt;
      else if (state.status === "stopped") station.stopped += c.dt;
      v["Starved"] = state.status === "starved";
      v["Blocked"] = state.status === "blocked";
      v["FaultActive"] = !healthy(e);
      if (e.type === "conveyor") {
        v["JamActive"] = e.faults.includes("jam");
        v["SensorActive"] = station.queue.some(
          (product) => product.progress >= 0.8,
        );
        v["ProductPosition"] = (head?.progress ?? 0) * e.parameters["length"];
      }
      if (e.type === "material-source") v["RunFeedback"] = active;
      if (e.type === "machine" || e.type === "inspection") {
        v["CycleProgress"] = (head?.progress ?? 0) * 100;
        if (state.status !== "running")
          v["Power"] = active ? e.parameters["ratedPower"] * 0.08 : 0;
      }
    }
    for (const move of moves) {
      const source = this.stations.get(move.from.id)!;
      source.queue.shift();
      source.output++;
      if (move.to.type === "sink" || move.to.type === "counter") {
        const sink = this.stations.get(move.to.id)!;
        if (move.product.rejected) {
          sink.rejects++;
          this.rejected++;
        } else {
          sink.output++;
          this.completed++;
        }
        this.totalLeadTime += c.time + c.dt - move.product.bornAt;
      } else
        this.stations.get(move.to.id)!.queue.push({
          ...move.product,
          inspected: false,
          progress: move.to.type === "buffer" ? 1 : 0,
        });
    }
    for (const e of equipment) {
      const station = this.stations.get(e.id)!;
      const state = states[e.id];
      state.values["QueueLength"] = station.queue.length;
      state.values["ProductCount"] = station.output;
      if (e.type === "sink" || e.type === "inspection")
        state.values["RejectCount"] = station.rejects;
      if (e.type === "buffer") state.values["Capacity"] = materialCapacity(e);
      state.products = station.queue.map((p) => ({
        id: p.id,
        progress: p.progress,
        rejected: p.rejected,
      }));
    }
  }
  metrics(
    project: Project,
    states: Record<string, EquipmentState>,
    time: number,
  ): ProductionMetrics | null {
    if (!project.equipment.some((e) => e.type === "material-source"))
      return null;
    const stations: StationMetrics[] = project.equipment
      .filter(isMaterial)
      .map((e) => {
        const s = this.stations.get(e.id)!;
        return {
          id: e.id,
          tag: e.tag,
          status: states[e.id]?.status ?? "stopped",
          capacity: materialCapacity(e),
          occupancy: s.queue.length,
          busySeconds: s.busy,
          starvedSeconds: s.starved,
          blockedSeconds: s.blocked,
          faultSeconds: s.fault,
          stoppedSeconds: s.stopped,
          utilization: time ? (s.busy / time) * 100 : 0,
          output: s.output,
        };
      });
    const work = stations.filter((s) =>
      project.equipment.some(
        (e) =>
          e.id === s.id && (e.type === "machine" || e.type === "inspection"),
      ),
    );
    const constraint = [...work].sort(
      (a, b) => b.utilization - a.utilization || a.id.localeCompare(b.id),
    )[0];
    return {
      generated: this.serial,
      completed: this.completed,
      rejected: this.rejected,
      wip: [...this.stations.values()].reduce(
        (sum, s) => sum + s.queue.length,
        0,
      ),
      throughputPerHour: time ? (this.completed / time) * 3600 : 0,
      averageCycleTime:
        this.completed + this.rejected
          ? this.totalLeadTime / (this.completed + this.rejected)
          : 0,
      utilization: work.length
        ? work.reduce((sum, s) => sum + s.utilization, 0) / work.length
        : 0,
      downtimeSeconds: stations.reduce((sum, s) => sum + s.faultSeconds, 0),
      bottleneck:
        constraint && constraint.utilization > 0
          ? {
              id: constraint.id,
              tag: constraint.tag,
              utilization: constraint.utilization,
            }
          : null,
      stations,
    };
  }
}

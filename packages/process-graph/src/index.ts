import type { Project, Equipment, Connection } from "@twynix/shared-types";
import { definitions } from "@twynix/equipment-models";
export function validateProject(p: Project): void {
  const ids = new Set<string>();
  const tags = new Set<string>();
  for (const e of p.equipment) {
    if (ids.has(e.id) || tags.has(e.tag))
      throw Error("Equipment IDs and tags must be unique");
    ids.add(e.id);
    tags.add(e.tag);
    const params = e.parameters;
    for (const key of Object.keys(definitions[e.type].defaults)) {
      if (!(key in params)) throw Error(`Missing parameter ${key}`);
    }
    for (const key of [
      "nominalFlow",
      "ratedPower",
      "speed",
      "noise",
      "filter",
      "delay",
      "coefficient",
    ]) {
      if (key in params && (params[key] < 0 || params[key] > 1000000))
        throw Error(`Invalid ${key}`);
    }
    if (
      e.type === "tank" &&
      (!(params["low"] >= 0) ||
        !(params["high"] <= 100) ||
        params["low"] >= params["high"])
    )
      throw Error("Invalid tank alarm thresholds");
    for (const [key, value] of Object.entries(params)) {
      if (!Number.isFinite(value)) throw Error(`Invalid ${key}`);
    }
    for (const key of [
      "capacity",
      "rampTime",
      "actuationTime",
      "length",
      "cycleTime",
    ])
      if (key in params && params[key] <= 0)
        throw Error(`${key} must be positive`);
    if (
      e.type === "tank" &&
      (params["initialVolume"] < 0 ||
        params["initialVolume"] > params["capacity"])
    )
      throw Error("Initial volume outside tank capacity");
    for (const t of definitions[e.type].tags.filter((t) => t.writable)) {
      const v = e.commands[t.name];
      if (
        v !== undefined &&
        (typeof v !== t.type ||
          (typeof v === "number" &&
            ((t.min !== undefined && v < t.min) ||
              (t.max !== undefined && v > t.max))))
      )
        throw Error(`Invalid command ${t.name}`);
    }
    for (const key of Object.keys(e.commands))
      if (!definitions[e.type].tags.some((t) => t.name === key && t.writable))
        throw Error(`Unknown command ${key}`);
  }
  const used = new Set<string>();
  const connectionIds = new Set<string>();
  for (const c of p.connections) {
    if (connectionIds.has(c.id)) throw Error("Duplicate connection ID");
    connectionIds.add(c.id);
    validateConnection(p.equipment, c);
    for (const key of [`${c.from}:${c.fromPort}`, `${c.to}:${c.toPort}`]) {
      if (used.has(key)) throw Error("A port can only have one connection");
      used.add(key);
    }
  }
  for (const r of p.controllers) {
    if (
      p.equipment.find((e) => e.id === r.tank)?.type !== "tank" ||
      p.equipment.find((e) => e.id === r.pump)?.type !== "pump" ||
      r.low >= r.high
    )
      throw Error("Invalid level controller");
  }
  for (const s of p.scenarios)
    if (!ids.has(s.equipmentId)) throw Error("Unknown scenario equipment");
}
export function validateConnection(
  equipment: Equipment[],
  c: Connection,
): void {
  if (c.from === c.to) throw Error("Self connections are not supported");
  const a = equipment.find((e) => e.id === c.from),
    b = equipment.find((e) => e.id === c.to);
  if (!a || !b) throw Error("Connection equipment is missing");
  const x = definitions[a.type].ports.find((p) => p.id === c.fromPort),
    y = definitions[b.type].ports.find((p) => p.id === c.toPort);
  if (
    !x ||
    !y ||
    x.direction === "input" ||
    y.direction === "output" ||
    x.domain !== y.domain ||
    (x.domain === "signal" && x.dataType !== y.dataType)
  )
    throw Error("Incompatible ports");
}
// Traversal ends at storage boundaries and uses visited IDs, so feedback loops never recurse.
export function fluidPaths(p: Project, start: string): string[] {
  const result: string[] = [];
  const visited = new Set([start]);
  let current = start;
  while (true) {
    const link = p.connections.find(
      (c) => c.from === current && c.fromPort === "out",
    );
    if (!link) break;
    if (visited.has(link.to)) {
      if (
        link.to === start &&
        p.equipment.find((e) => e.id === start)?.type === "tank"
      )
        result.push(start);
      break;
    }
    visited.add(link.to);
    result.push(link.to);
    const next = p.equipment.find((e) => e.id === link.to);
    if (!next || next.type === "tank") break;
    current = next.id;
  }
  return result;
}

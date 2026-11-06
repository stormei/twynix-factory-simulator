import type {
  Equipment,
  EquipmentType,
  EquipmentState,
  PortDefinition,
  TagDefinition,
  SimulationContext,
} from "@twynix/shared-types";
const n = (
  name: string,
  unit: string,
  writable = false,
  min?: number,
  max?: number,
): TagDefinition => ({ name, unit, type: "number", writable, min, max });
const b = (name: string, writable = false): TagDefinition => ({
  name,
  unit: "",
  type: "boolean",
  writable,
});
const fluid: PortDefinition[] = [
  { id: "in", name: "Inlet", direction: "input", domain: "fluid" },
  { id: "out", name: "Outlet", direction: "output", domain: "fluid" },
];
const material: PortDefinition[] = fluid.map((p) => ({
  ...p,
  domain: "material",
}));
const flow = [n("FlowRate", "L/s")];
const drive = [
  b("RunCommand", true),
  b("RunFeedback"),
  n("SpeedSetpoint", "%", true, 0, 100),
  n("ActualSpeed", "%"),
  n("MotorCurrent", "A"),
  n("Power", "kW"),
  n("Temperature", "°C"),
  n("OperatingHours", "h"),
  b("FaultActive"),
];
export const definitions: Record<
  EquipmentType,
  {
    name: string;
    category: string;
    ports: PortDefinition[];
    tags: TagDefinition[];
    defaults: Record<string, number>;
  }
> = {
  "material-source": {
    name: "Product feeder",
    category: "Manufacturing",
    ports: [material[1]],
    tags: [
      b("RunCommand", true),
      b("RunFeedback"),
      b("FaultActive"),
      n("ProductCount", "pcs"),
      n("QueueLength", "pcs"),
      b("Blocked"),
    ],
    defaults: { interval: 2 },
  },
  buffer: {
    name: "Accumulation buffer",
    category: "Manufacturing",
    ports: material,
    tags: [
      n("QueueLength", "pcs"),
      n("Capacity", "pcs"),
      n("ProductCount", "pcs"),
      b("Blocked"),
      b("FaultActive"),
    ],
    defaults: { capacity: 4 },
  },
  inspection: {
    name: "Vision inspection",
    category: "Manufacturing",
    ports: material,
    tags: [
      ...drive,
      n("ProductCount", "pcs"),
      n("RejectCount", "pcs"),
      n("CycleProgress", "%"),
      n("QueueLength", "pcs"),
      b("Starved"),
      b("Blocked"),
    ],
    defaults: {
      cycleTime: 2,
      rejectRate: 0.05,
      rampTime: 0.5,
      ratedPower: 0.5,
    },
  },
  sink: {
    name: "Finished goods",
    category: "Manufacturing",
    ports: [material[0]],
    tags: [
      n("ProductCount", "pcs"),
      n("RejectCount", "pcs"),
      n("QueueLength", "pcs"),
    ],
    defaults: {},
  },
  source: {
    name: "Water source",
    category: "Process",
    ports: [fluid[1]],
    tags: flow,
    defaults: { nominalFlow: 40 },
  },
  tank: {
    name: "Storage tank",
    category: "Process",
    ports: fluid,
    tags: [
      n("Volume", "L"),
      n("Level", "%"),
      n("Inflow", "L/s"),
      n("Outflow", "L/s"),
      b("HighLevelAlarm"),
      b("LowLevelAlarm"),
    ],
    defaults: { capacity: 5000, initialVolume: 1250, high: 90, low: 10 },
  },
  pump: {
    name: "Centrifugal pump",
    category: "Process",
    ports: fluid,
    tags: [...drive, ...flow],
    defaults: { nominalFlow: 35, rampTime: 3, ratedPower: 5.5 },
  },
  valve: {
    name: "Control valve",
    category: "Process",
    ports: fluid,
    tags: [
      b("OpenCommand", true),
      b("OpenFeedback"),
      n("Position", "%"),
      ...flow,
    ],
    defaults: { actuationTime: 2, coefficient: 1, delay: 0 },
  },
  pipe: {
    name: "Pipe",
    category: "Process",
    ports: fluid,
    tags: flow,
    defaults: { coefficient: 1 },
  },
  "flow-sensor": {
    name: "Flow transmitter",
    category: "Instruments",
    ports: fluid,
    tags: [n("Measurement", "L/s")],
    defaults: { noise: 0.03, filter: 0.4, offset: 0, drift: 0, delay: 0 },
  },
  "level-sensor": {
    name: "Level transmitter",
    category: "Instruments",
    ports: [
      {
        id: "in",
        name: "Tank reference",
        direction: "input",
        domain: "signal",
        dataType: "number",
      },
    ],
    tags: [n("Measurement", "%")],
    defaults: { noise: 0.04, filter: 0.5, offset: 0, drift: 0, delay: 0 },
  },
  "pressure-sensor": {
    name: "Pressure transmitter",
    category: "Instruments",
    ports: fluid,
    tags: [n("Measurement", "bar")],
    defaults: { noise: 0.01, filter: 0.4, offset: 0, drift: 0, delay: 0 },
  },
  conveyor: {
    name: "Belt conveyor",
    category: "Manufacturing",
    ports: material,
    tags: [
      ...drive,
      n("ProductCount", "pcs"),
      n("ProductPosition", "m"),
      n("QueueLength", "pcs"),
      b("Starved"),
      b("Blocked"),
      b("SensorActive"),
      b("JamActive"),
    ],
    defaults: { speed: 1, length: 5, rampTime: 1, ratedPower: 1.5 },
  },
  motor: {
    name: "Electric motor",
    category: "Manufacturing",
    ports: [
      { id: "out", name: "Drive", direction: "output", domain: "electrical" },
    ],
    tags: drive,
    defaults: { rampTime: 2, ratedPower: 3 },
  },
  "photo-sensor": {
    name: "Photoelectric sensor",
    category: "Manufacturing",
    ports: [material[0]],
    tags: [b("Detection"), n("Measurement", "")],
    defaults: { noise: 0, filter: 0, offset: 0, drift: 0, delay: 0 },
  },
  machine: {
    name: "Production machine",
    category: "Manufacturing",
    ports: material,
    tags: [
      ...drive,
      n("ProductCount", "pcs"),
      n("CycleProgress", "%"),
      n("QueueLength", "pcs"),
      b("Starved"),
      b("Blocked"),
    ],
    defaults: { cycleTime: 5, rampTime: 1, ratedPower: 4 },
  },
  counter: {
    name: "Product counter",
    category: "Manufacturing",
    ports: [material[0]],
    tags: [n("ProductCount", "pcs")],
    defaults: {},
  },
};
// A separate signal output lets level transmitters reference a tank without a fictitious fluid branch.
definitions.tank.ports = [
  ...fluid,
  {
    id: "level",
    name: "Level",
    direction: "output",
    domain: "signal",
    dataType: "number",
  },
];
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export function initial(e: Equipment): EquipmentState {
  const values: EquipmentState["values"] = {};
  for (const t of definitions[e.type].tags)
    values[t.name] = t.type === "boolean" ? false : 0;
  Object.assign(values, e.commands);
  if (e.type === "buffer") values["Capacity"] = e.parameters["capacity"];
  if (e.type === "tank") {
    values["Volume"] = e.parameters["initialVolume"];
    values["Level"] =
      (100 * e.parameters["initialVolume"]) / e.parameters["capacity"];
  }
  if (e.type === "valve")
    values["Position"] = e.commands["OpenCommand"] ? 100 : 0;
  return { values, quality: "Good", status: "stopped" };
}
export function actuator(
  e: Equipment,
  prev: EquipmentState,
  c: SimulationContext,
): EquipmentState {
  const s: EquipmentState = {
    values: { ...prev.values, ...e.commands },
    quality: "Good",
    status: "stopped",
  };
  const v = s.values;
  const p = e.parameters;
  const fault = e.faults.includes("trip") || e.faults.includes("overheat");
  v["FaultActive"] = fault;
  if (["pump", "motor", "conveyor", "machine", "inspection"].includes(e.type)) {
    const target =
      v["RunCommand"] &&
      !fault &&
      !e.faults.includes("fail-start") &&
      !e.faults.includes("jam")
        ? Number(v["SpeedSetpoint"] ?? 100)
        : 0;
    const old = Number(v["ActualSpeed"]);
    const delta = (100 * c.dt) / Math.max(p["rampTime"] ?? 1, 0.1);
    v["ActualSpeed"] = fault ? 0 : old + clamp(target - old, -delta, delta);
    v["RunFeedback"] = Number(v["ActualSpeed"]) > 1;
    v["MotorCurrent"] =
      Number(v["RunFeedback"]) *
      (1 + 8 * Math.pow(Number(v["ActualSpeed"]) / 100, 2));
    v["Power"] =
      (p["ratedPower"] ?? 3) * Math.pow(Number(v["ActualSpeed"]) / 100, 3);
    v["Temperature"] =
      Number(v["Temperature"] || 20) +
      (((e.faults.includes("overheat") ? 110 : 20 + Number(v["Power"]) * 6) -
        Number(v["Temperature"] || 20)) *
        c.dt) /
        20;
    v["OperatingHours"] =
      Number(v["OperatingHours"]) + (v["RunFeedback"] ? c.dt / 3600 : 0);
    s.status = fault
      ? "fault"
      : e.faults.includes("jam")
        ? "jammed"
        : v["RunFeedback"]
          ? "running"
          : "stopped";
  }
  if (e.type === "valve") {
    const target = e.faults.includes("stuck-open")
      ? 100
      : e.faults.includes("stuck-closed")
        ? 0
        : v["OpenCommand"]
          ? 100
          : 0;
    const changed = prev.values["OpenCommand"] !== v["OpenCommand"];
    v["_delay"] = changed ? 0 : Number(prev.values["_delay"] ?? 0) + c.dt;
    if (Number(v["_delay"]) >= (p["delay"] ?? 0))
      v["Position"] =
        Number(v["Position"]) +
        clamp(
          target - Number(v["Position"]),
          (-100 * c.dt) / p["actuationTime"],
          (100 * c.dt) / p["actuationTime"],
        );
    v["OpenFeedback"] = Number(v["Position"]) >= 99;
    s.status = Number(v["Position"]) > 0 ? "open" : "closed";
  }
  return s;
}

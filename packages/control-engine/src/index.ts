import type { Project, EquipmentState, Value } from "@twynix/shared-types";
import { definitions } from "@twynix/equipment-models";
export function command(
  p: Project,
  id: string,
  tag: string,
  value: Value,
  source: "ui" | "opcua",
): void {
  const e = p.equipment.find((e) => e.id === id);
  if (!e) throw Error("Unknown equipment");
  const t = definitions[e.type].tags.find((t) => t.name === tag && t.writable);
  if (!t) throw Error("Variable is read-only");
  if (
    p.weather?.mode === "forecast" &&
    e.type === "pv-array" &&
    ["IrradianceSetpoint", "AmbientTemperature"].includes(tag)
  )
    throw Error(
      "Forecast weather owns irradiance and air temperature; switch weather to manual to override",
    );
  if (
    typeof value !== t.type ||
    typeof value === "string" ||
    (typeof value === "number" &&
      (!Number.isFinite(value) ||
        (t.min !== undefined && value < t.min) ||
        (t.max !== undefined && value > t.max)))
  )
    throw Error("Invalid command type or range");
  if (
    (source === "opcua" && e.mode !== "external") ||
    (source === "ui" && e.mode !== "manual")
  )
    throw Error(`Equipment is in ${e.mode} mode`);
  if (
    tag === "RunCommand" &&
    value === true &&
    (e.faults.includes("trip") || e.faults.includes("overheat"))
  )
    throw Error("Start interlock: equipment tripped");
  e.commands[tag] = value;
}
export function evaluateControllers(
  p: Project,
  states: Record<string, EquipmentState>,
): void {
  for (const r of p.controllers) {
    const pump = p.equipment.find((e) => e.id === r.pump);
    if (!r.enabled || !pump || pump.mode !== "automatic") continue;
    const level = Number(states[r.tank]?.values["Level"]);
    if (level < r.low) pump.commands["RunCommand"] = true;
    else if (level > r.high) pump.commands["RunCommand"] = false;
  }
}

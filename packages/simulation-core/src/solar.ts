import type {
  EquipmentState,
  Project,
  SimulationContext,
  SolarMetrics,
} from "@twynix/shared-types";
import { clamp } from "@twynix/equipment-models";
import { weatherAt } from "./weather";

/** Aggregate balanced three-phase energy model; no network or browser dependencies. */
export function stepSolar(
  project: Project,
  previous: Record<string, EquipmentState>,
  states: Record<string, EquipmentState>,
  c: SimulationContext,
): void {
  const number = (id: string, key: string) =>
    Number(states[id]?.values[key] ?? 0);
  const inverters = project.equipment.filter((e) => e.type === "kaco-inverter");
  const forecast = weatherAt(project, c.time);
  for (const e of project.equipment.filter((e) => e.type === "pv-array")) {
    const v = states[e.id].values,
      p = e.parameters;
    const cloud =
      1 -
      p["cloudDepth"] *
        (0.5 +
          0.5 *
            Math.sin(
              2 * Math.PI * (c.time / p["cloudPeriod"] + p["cloudPhase"]),
            ));
    const irradiance =
      (forecast
        ? forecast.irradiance
        : Number(v["IrradianceSetpoint"]) * cloud) *
      (1 - Number(v["ShadingPercent"]) / 100);
    v["AirTemperature"] =
      forecast?.temperature ?? Number(v["AmbientTemperature"]);
    const cell =
      Number(v["AirTemperature"]) + ((p["noct"] - 20) * irradiance) / 800;
    v["Irradiance"] = irradiance;
    v["CellTemperature"] = cell;
    v["AvailablePower"] = Math.max(
      0,
      ((p["ratedPower"] * irradiance) / 1000) *
        (1 + p["temperatureCoefficient"] * (cell - 25)),
    );
    v["DCVoltage"] =
      irradiance > 1
        ? clamp(p["nominalVoltage"] * (1 - 0.0028 * (cell - 25)), 0, 1100)
        : 0;
    v["DCPower"] = 0;
    v["DCCurrent"] = 0;
    states[e.id].status = irradiance > 1 ? "available" : "night";
  }
  // Evaluate inverters from current-step array availability and the connected meter's grid settings.
  for (const e of inverters) {
    const s = states[e.id],
      v = s.values,
      p = e.parameters;
    const before = previous[e.id].values;
    const dcLink = project.connections.find(
      (l) => l.to === e.id && l.toPort === "in",
    );
    const acLink = project.connections.find(
      (l) => l.from === e.id && l.fromPort === "out",
    );
    const meter = project.equipment.find(
      (m) => m.id === acLink?.to && m.type === "grid-meter",
    );
    const grid = meter ? states[meter.id].values : undefined;
    const voltage = Number(grid?.["GridVoltage"] ?? 0),
      frequency = Number(grid?.["GridFrequency"] ?? 0);
    const gridAvailable =
      Boolean(grid?.["GridConnected"]) &&
      !meter?.faults.includes("trip") &&
      voltage >= 305 &&
      voltage <= 560 &&
      frequency >= 45 &&
      frequency <= 65;
    const available = dcLink ? number(dcLink.from, "AvailablePower") : 0;
    const dcVoltage = dcLink ? number(dcLink.from, "DCVoltage") : 0;
    const ambient = dcLink ? number(dcLink.from, "AirTemperature") : 20;
    const fault = e.faults.includes("trip") || e.faults.includes("overheat");
    const temperature =
      Number(before["Temperature"] || ambient) +
      ((ambient +
        (Number(before["ACPower"]) / p["ratedPower"]) * 25 +
        (e.faults.includes("overheat") ? 65 : 0) -
        Number(before["Temperature"] || ambient)) *
        c.dt) /
        30;
    const derating = clamp(
      (p["derateStop"] - temperature) / (p["derateStop"] - p["derateStart"]),
      0,
      1,
    );
    const ready =
      Boolean(v["RunCommand"]) &&
      !fault &&
      !e.faults.includes("fail-start") &&
      gridAvailable &&
      dcVoltage >= 250 &&
      dcVoltage <= 1000 &&
      available > 0.05;
    const elapsed = ready ? Number(before["StartupElapsed"]) + c.dt : 0;
    const limit = v["PowerLimitEnabled"]
      ? Number(v["PowerLimitPercent"]) / 100
      : 1;
    const target =
      ready && elapsed + 1e-9 >= p["startupTime"]
        ? Math.min(
            available * p["efficiency"],
            p["ratedPower"] * limit,
            p["ratedPower"] * derating,
          )
        : 0;
    const ac =
      target <= Number(before["ACPower"])
        ? target
        : Math.min(
            target,
            Number(before["ACPower"]) +
              (p["ratedPower"] * c.dt) / p["rampTime"],
          );
    v["ACPower"] = ac;
    v["RatedPower"] = p["ratedPower"];
    v["ApparentPower"] = ac;
    v["ReactivePower"] = 0;
    v["PowerFactor"] = ac > 0 ? 1 : 0;
    v["DCPower"] = ac / p["efficiency"];
    v["DCVoltage"] = dcVoltage;
    v["DCCurrent"] =
      dcVoltage > 0 ? (Number(v["DCPower"]) * 1000) / dcVoltage : 0;
    v["ACVoltage"] = gridAvailable ? voltage : 0;
    v["ACCurrent"] = gridAvailable ? (ac * 1000) / (Math.sqrt(3) * voltage) : 0;
    v["Frequency"] = gridAvailable ? frequency : 0;
    v["Temperature"] = temperature;
    v["Energy"] = Number(before["Energy"]) + (ac * c.dt) / 3600;
    v["Efficiency"] = ac > 0 ? p["efficiency"] * 100 : 0;
    v["StartupElapsed"] = elapsed;
    v["RunFeedback"] = ac > 0;
    v["GridAvailable"] = gridAvailable;
    v["FaultActive"] = fault;
    v["EventFlags"] =
      (e.faults.includes("trip") ? 1 << 15 : 0) |
      (e.faults.includes("overheat") ? 1 << 7 : 0) |
      (!gridAvailable ? 1 << 4 : 0);
    const limited = target + 0.01 < available * p["efficiency"];
    v["OperatingState"] = fault
      ? 7
      : !v["RunCommand"]
        ? 1
        : !gridAvailable
          ? 8
          : available <= 0.05 || dcVoltage < 250
            ? 2
            : !ready
              ? 8
              : elapsed < p["startupTime"]
                ? 3
                : limited
                  ? 5
                  : 4;
    s.status = [
      "",
      "off",
      "sleeping",
      "starting",
      "running",
      "limited",
      "stopping",
      "fault",
      "standby",
    ][Number(v["OperatingState"])];
    if (dcLink) {
      states[dcLink.from].values["DCPower"] = v["DCPower"];
      states[dcLink.from].values["DCCurrent"] = v["DCCurrent"];
    }
  }
  for (const e of project.equipment.filter((e) => e.type === "grid-meter")) {
    const s = states[e.id],
      v = s.values,
      before = previous[e.id].values;
    const voltage = Number(v["GridVoltage"]),
      frequency = Number(v["GridFrequency"]);
    const available =
      Boolean(v["GridConnected"]) &&
      !e.faults.includes("trip") &&
      voltage >= 305 &&
      voltage <= 560 &&
      frequency >= 45 &&
      frequency <= 65;
    const generation = project.connections
      .filter((l) => l.to === e.id)
      .reduce((sum, l) => sum + number(l.from, "ACPower"), 0);
    const net = available ? generation - Number(v["SiteLoad"]) : 0;
    v["Generation"] = generation;
    v["ExportPower"] = net;
    v["ExportEnergy"] =
      Number(before["ExportEnergy"]) + (Math.max(0, net) * c.dt) / 3600;
    v["ImportEnergy"] =
      Number(before["ImportEnergy"]) + (Math.max(0, -net) * c.dt) / 3600;
    v["ACCurrent"] = available
      ? (Math.abs(net) * 1000) / (Math.sqrt(3) * voltage)
      : 0;
    v["GridAvailable"] = available;
    v["FaultActive"] = e.faults.includes("trip");
    s.status = available ? "connected" : "disconnected";
  }
}

export function solarMetrics(
  project: Project,
  states: Record<string, EquipmentState>,
): SolarMetrics | null {
  const inverters = project.equipment.filter((e) => e.type === "kaco-inverter");
  if (
    !inverters.length &&
    !project.equipment.some((e) => e.type === "pv-array")
  )
    return null;
  const sum = (type: string, key: string) =>
    project.equipment
      .filter((e) => e.type === type)
      .reduce((s, e) => s + Number(states[e.id].values[key] ?? 0), 0);
  return {
    dcPower: sum("pv-array", "DCPower"),
    acPower: sum("kaco-inverter", "ACPower"),
    exportPower: sum("grid-meter", "ExportPower"),
    energy: sum("kaco-inverter", "Energy"),
    online: inverters.filter((e) => states[e.id].values["RunFeedback"]).length,
    inverters: inverters.length,
  };
}

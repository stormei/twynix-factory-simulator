import type { Project } from "@twynix/shared-types";
import { equipment } from "./water-treatment";

/** 460 kWp DC / 350 kW AC; three independently controlled KACO-style OPC UA devices. */
export const solarDemo: Project = {
  schemaVersion: 1,
  id: "solar-farm",
  name: "Solar Farm · KACO NX3",
  seed: 2026,
  equipment: [
    ...[100, 125, 125].flatMap((rating, i) => {
      const array = equipment(
        `pv${i + 1}`,
        "pv-array",
        `PV-10${i + 1}`,
        80,
        80 + i * 380,
        { ratedPower: rating === 100 ? 140 : 160, cloudPhase: i * 0.08 },
      );
      array.label = `Panel field ${i + 1} · ${array.parameters["ratedPower"]} kWp`;
      const inverter = equipment(
        `inv${i + 1}`,
        "kaco-inverter",
        `INV-10${i + 1}`,
        410,
        80 + i * 380,
        { ratedPower: rating },
        { RunCommand: true },
      );
      inverter.label = `blueplanet ${rating} NX3`;
      inverter.mode = "external";
      return [array, inverter];
    }),
    {
      ...equipment("grid", "grid-meter", "GM-101", 790, 460),
      label: "Site grid meter",
    },
  ],
  connections: [1, 2, 3].flatMap((i) => [
    {
      id: `dc-${i}`,
      from: `pv${i}`,
      fromPort: "out",
      to: `inv${i}`,
      toPort: "in",
    },
    {
      id: `ac-${i}`,
      from: `inv${i}`,
      fromPort: "out",
      to: "grid",
      toPort: `in${i}`,
    },
  ]),
  controllers: [],
  scenarios: [],
};

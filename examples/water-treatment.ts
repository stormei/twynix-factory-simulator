import type { Project, Equipment, EquipmentType } from "@twynix/shared-types";
import { definitions } from "@twynix/equipment-models";
export function equipment(
  id: string,
  type: EquipmentType,
  tag: string,
  x: number,
  y: number,
  params: Record<string, number> = {},
  commands: Record<string, number | boolean> = {},
): Equipment {
  return {
    id,
    type,
    tag,
    label: definitions[type].name,
    x,
    y,
    mode: "manual",
    parameters: { ...definitions[type].defaults, ...params },
    commands: {
      ...Object.fromEntries(
        definitions[type].tags
          .filter((t) => t.writable)
          .map((t) => [t.name, t.name === "SpeedSetpoint" ? 100 : false]),
      ),
      ...commands,
    },
    faults: [],
  };
}
export const demo: Project = {
  schemaVersion: 1,
  id: "water-treatment",
  name: "Water Treatment Process",
  seed: 2026,
  equipment: [
    equipment("source", "source", "SRC-101", 70, 240),
    equipment("pump", "pump", "P-101", 250, 240),
    equipment("inlet", "valve", "XV-101", 440, 240, {}, { OpenCommand: true }),
    equipment("flow", "flow-sensor", "FT-101", 620, 240),
    equipment("tank", "tank", "T-101", 820, 210),
    equipment("outlet", "valve", "XV-102", 1060, 240),
    equipment("level", "level-sensor", "LT-101", 820, 440),
  ],
  connections: [
    { id: "c1", from: "source", fromPort: "out", to: "pump", toPort: "in" },
    { id: "c2", from: "pump", fromPort: "out", to: "inlet", toPort: "in" },
    { id: "c3", from: "inlet", fromPort: "out", to: "flow", toPort: "in" },
    { id: "c4", from: "flow", fromPort: "out", to: "tank", toPort: "in" },
    { id: "c5", from: "tank", fromPort: "out", to: "outlet", toPort: "in" },
    { id: "c6", from: "tank", fromPort: "level", to: "level", toPort: "in" },
  ],
  controllers: [
    {
      id: "LIC-101",
      tank: "tank",
      pump: "pump",
      low: 30,
      high: 80,
      enabled: true,
    },
  ],
  scenarios: [],
};

// The demo starts in automatic level regulation; select Manual or External to take control.
demo.equipment.find((e) => e.id === "pump")!.mode = "automatic";

import { z } from "zod";
export const equipmentTypes = [
  "source",
  "tank",
  "pump",
  "valve",
  "pipe",
  "flow-sensor",
  "level-sensor",
  "pressure-sensor",
  "conveyor",
  "motor",
  "photo-sensor",
  "machine",
  "counter",
] as const;
export type EquipmentType = (typeof equipmentTypes)[number];
export type Quality = "Good" | "Bad" | "Uncertain";
export type Value = number | boolean | string;
export interface PortDefinition {
  id: string;
  name: string;
  direction: "input" | "output" | "bidirectional";
  domain: "fluid" | "material" | "signal" | "electrical";
  dataType?: "boolean" | "number" | "enum";
}
export interface TagDefinition {
  name: string;
  unit: string;
  type: "number" | "boolean";
  writable?: boolean;
  min?: number;
  max?: number;
}
export const equipmentSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  type: z.enum(equipmentTypes),
  tag: z.string().min(1).max(64),
  label: z.string().max(100),
  x: z.number().finite().min(-10000).max(10000),
  y: z.number().finite().min(-10000).max(10000),
  mode: z.enum(["manual", "automatic", "external"]),
  parameters: z.record(z.string(), z.number().finite()),
  commands: z.record(z.string(), z.union([z.number().finite(), z.boolean()])),
  faults: z.array(
    z.enum([
      "trip",
      "fail-start",
      "stuck-open",
      "stuck-closed",
      "stuck",
      "drift",
      "jam",
      "overheat",
      "invalid",
      "leak",
    ]),
  ),
});
export type Equipment = z.infer<typeof equipmentSchema>;
export const connectionSchema = z.object({
  id: z.string().min(1),
  from: z.string(),
  fromPort: z.string(),
  to: z.string(),
  toPort: z.string(),
});
export type Connection = z.infer<typeof connectionSchema>;
export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().min(1).max(100),
  seed: z.number().int().min(1).max(2147483647),
  equipment: z.array(equipmentSchema).max(500),
  connections: z.array(connectionSchema).max(2000),
  controllers: z.array(
    z.object({
      id: z.string(),
      tank: z.string(),
      pump: z.string(),
      low: z.number().min(0).max(100),
      high: z.number().min(0).max(100),
      enabled: z.boolean(),
    }),
  ),
  scenarios: z
    .array(
      z.object({
        at: z.number().min(0),
        equipmentId: z.string(),
        fault: z.enum([
          "trip",
          "fail-start",
          "stuck-open",
          "stuck-closed",
          "stuck",
          "drift",
          "jam",
          "overheat",
          "invalid",
          "leak",
        ]),
        active: z.boolean(),
      }),
    )
    .default([]),
});
export type Project = z.infer<typeof projectSchema>;
export interface EquipmentState {
  values: Record<string, Value>;
  quality: Quality;
  status: string;
}
export interface RuntimeEvent {
  seq: number;
  time: number;
  severity: "info" | "warning" | "alarm";
  message: string;
}
export interface Snapshot {
  status: "stopped" | "running" | "paused";
  time: number;
  speed: number;
  revision: number;
  states: Record<string, EquipmentState>;
  events: RuntimeEvent[];
  opcua: {
    endpoint: string;
    sessions: number;
    running: boolean;
    secure: boolean;
  };
}
export interface SimulationContext {
  dt: number;
  time: number;
  random: () => number;
}
export interface SimulationInputs {
  flow: number;
  measurement: number;
  powered: boolean;
}
export interface SimulationStepResult<T> {
  state: T;
}
export interface SimulationComponent<TState, TParameters> {
  readonly id: string;
  readonly type: string;
  readonly parameters: TParameters;
  initialize(): TState;
  step(
    state: Readonly<TState>,
    inputs: Readonly<SimulationInputs>,
    context: SimulationContext,
  ): SimulationStepResult<TState>;
}
export function migrateProject(input: unknown): Project {
  return projectSchema.parse(input);
}

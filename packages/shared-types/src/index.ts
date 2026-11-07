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
  "material-source",
  "buffer",
  "inspection",
  "sink",
  "pv-array",
  "kaco-inverter",
  "grid-meter",
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
export const solarSiteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  tilt: z.number().finite().min(0).max(90),
  azimuth: z.number().finite().min(0).max(360),
});
export type SolarSite = z.infer<typeof solarSiteSchema>;
export const forecastSchema = z
  .object({
    provider: z.literal("Open-Meteo"),
    fetchedAt: z.iso.datetime(),
    samples: z
      .array(
        z.object({
          time: z.number().int().min(0).max(4102444800),
          irradiance: z.number().finite().min(0).max(2200),
          temperature: z.number().finite().min(-90).max(65),
          cloudCover: z.number().finite().min(0).max(100),
        }),
      )
      .min(2)
      .max(192),
  })
  .superRefine((forecast, ctx) => {
    if (
      forecast.samples.some(
        (s, i) => i > 0 && s.time !== forecast.samples[i - 1].time + 3600,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Forecast samples must be consecutive hourly UTC values",
      });
  });
export const weatherSchema = z
  .object({
    mode: z.enum(["manual", "forecast"]),
    site: solarSiteSchema,
    startTime: z.iso.datetime(),
    forecast: forecastSchema.optional(),
  })
  .superRefine((weather, ctx) => {
    if (weather.mode !== "forecast") return;
    const samples = weather.forecast?.samples;
    const start = Date.parse(weather.startTime) / 1000;
    if (!samples || start < samples[0].time || start >= samples.at(-1)!.time)
      ctx.addIssue({
        code: "custom",
        message:
          "Forecast mode needs saved weather data and a start time within its coverage",
      });
  });
export type WeatherConfig = z.infer<typeof weatherSchema>;
export interface WeatherConditions {
  time: string;
  irradiance: number;
  temperature: number;
  cloudCover: number;
  sunElevation: number;
  sunAzimuth: number;
  exhausted: boolean;
}
export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().min(1).max(100),
  seed: z.number().int().min(1).max(2147483647),
  weather: weatherSchema.optional(),
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
  products?: { id: number; progress: number; rejected: boolean }[];
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
  production: ProductionMetrics | null;
  solar: SolarMetrics | null;
  weather: WeatherConditions | null;
  opcua: {
    endpoint: string;
    sessions: number;
    running: boolean;
    secure: boolean;
  };
}
export interface SolarMetrics {
  dcPower: number;
  acPower: number;
  exportPower: number;
  energy: number;
  online: number;
  inverters: number;
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

export interface StationMetrics {
  id: string;
  tag: string;
  status: string;
  capacity: number;
  occupancy: number;
  busySeconds: number;
  starvedSeconds: number;
  blockedSeconds: number;
  faultSeconds: number;
  stoppedSeconds: number;
  utilization: number;
  output: number;
}
export interface ProductionMetrics {
  generated: number;
  completed: number;
  rejected: number;
  wip: number;
  throughputPerHour: number;
  averageCycleTime: number;
  utilization: number;
  downtimeSeconds: number;
  bottleneck: { id: string; tag: string; utilization: number } | null;
  stations: StationMetrics[];
}
export const experimentSchema = z.object({
  duration: z.number().min(10).max(1800),
  variants: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        overrides: z
          .array(
            z.object({
              equipmentId: z.string(),
              parameter: z.string(),
              value: z.number().finite(),
            }),
          )
          .max(30),
      }),
    )
    .min(1)
    .max(4),
});
export type ExperimentRequest = z.infer<typeof experimentSchema>;
export interface ExperimentResult {
  name: string;
  overrides: ExperimentRequest["variants"][number]["overrides"];
  metrics: ProductionMetrics;
}
export interface ExperimentReport {
  id: string;
  project: Project;
  createdAt: string;
  duration: number;
  results: ExperimentResult[];
}

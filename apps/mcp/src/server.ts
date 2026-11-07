import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  projectSchema,
  equipmentTypes,
  solarSiteSchema,
} from "@twynix/shared-types";
import { definitions, defaultCommands } from "@twynix/equipment-models";
import { demo } from "../../../examples/water-treatment";
import { productionDemo } from "../../../examples/production-line";
import { solarDemo } from "../../../examples/solar-farm";

const instructions = `Build simulation projects, never real-equipment controllers. Read the equipment catalog and a template first. Keep equipment/project IDs stable; populate parameters and commands using catalog defaults. Connect compatible ports; one connection per port. Validate and preview before saving. Use a new project ID to save a draft without changing the active simulation. Read simulator context immediately before any live mutation; pass its project ID and revision. Never pause, replace, reset, or overwrite somebody else's run without their request. Commands respect Manual ownership, trip interlocks and forecast ownership. Only one live runtime currently exists; saved projects and isolated previews do not imply concurrent live instances. Do not write code or expressions into project definitions. Forecast downloads need explicit user intent and provider internet access.`;
export function createSimulatorMcp(options: {
  backendUrl: string;
  token?: string;
}) {
  const base = new URL(options.backendUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    !["http:", "https:"].includes(base.protocol)
  )
    throw Error(
      "Use a plain backend origin without credentials, query or path",
    );
  if (
    base.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw Error("Remote simulator connections require HTTPS");
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(new URL("/api/" + path, base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    const data: unknown = await response.json();
    if (!response.ok)
      throw Error(
        z.object({ error: z.string() }).safeParse(data).data?.error ??
          `Backend request rejected (${response.status})`,
      );
    return data;
  };
  const result = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: { data },
  });
  const safe = async (fn: () => unknown | Promise<unknown>) => {
    try {
      return result(await fn());
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              error instanceof TypeError
                ? "Could not contact the simulator backend. Start it and check the configured backend origin."
                : error instanceof Error
                  ? error.message
                  : "Simulator request failed",
          },
        ],
        isError: true,
      };
    }
  };
  const server = new McpServer(
    { name: "twynix-simulator", version: "0.1.0" },
    { instructions },
  );
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const write = {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  };
  const live = {
    projectId: z
      .string()
      .describe("Currently active project ID from get_simulator_context"),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .describe("Fresh revision from get_simulator_context"),
  };
  server.registerTool(
    "search_weather_locations",
    {
      description:
        "Search a place name through the weather provider. Transmits the search text; use only when location lookup is requested. Does not modify a project.",
      inputSchema: z.object({ query: z.string().trim().min(2).max(100) }),
      annotations: { ...read, openWorldHint: true },
    },
    async ({ query }) =>
      safe(() => api("weather/locations?query=" + encodeURIComponent(query))),
  );
  server.registerTool(
    "get_weather_forecast",
    {
      description:
        "Download seven days of panel irradiance, temperature and cloud cover for an explicitly requested site. Sends coordinates/orientation to Open-Meteo. Returns a weather configuration for a draft; does not apply it to the live run.",
      inputSchema: solarSiteSchema,
      annotations: { ...read, openWorldHint: true },
    },
    async (site) => safe(() => api("weather/forecast", site)),
  );
  server.registerTool(
    "get_equipment_catalog",
    {
      description:
        "Discover supported equipment, ports, tags, parameter defaults and command defaults.",
      inputSchema: z.object({ type: z.enum(equipmentTypes).optional() }),
      annotations: read,
    },
    async ({ type }) =>
      safe(() =>
        Object.fromEntries(
          Object.entries(definitions)
            .filter(([key]) => !type || key === type)
            .map(([key, definition]) => [
              key,
              {
                ...definition,
                defaultCommands: defaultCommands(
                  key as (typeof equipmentTypes)[number],
                ),
              },
            ]),
        ),
      ),
  );
  server.registerTool(
    "get_project_template",
    {
      description:
        "Get a complete valid solar, production or water example to customize with a NEW project ID.",
      inputSchema: z.object({
        template: z.enum(["solar-farm", "production-line", "water-treatment"]),
      }),
      annotations: read,
    },
    async ({ template }) =>
      safe(() =>
        structuredClone(
          template === "solar-farm"
            ? solarDemo
            : template === "production-line"
              ? productionDemo
              : demo,
        ),
      ),
  );
  server.registerTool(
    "list_projects",
    {
      description:
        "List saved project definitions. These are not separate running instances.",
      inputSchema: z.object({}),
      annotations: read,
    },
    async () => safe(() => api("projects")),
  );
  server.registerTool(
    "get_saved_project",
    {
      description: "Read a saved project definition by ID.",
      inputSchema: z.object({ id: z.string() }),
      annotations: read,
    },
    async ({ id }) =>
      safe(() => api("agent/projects/" + encodeURIComponent(id))),
  );
  server.registerTool(
    "get_simulator_context",
    {
      description:
        "Get active project, runtime snapshot, revision and current concurrency capabilities.",
      inputSchema: z.object({}),
      annotations: read,
    },
    async () => safe(() => api("agent/context")),
  );
  server.registerTool(
    "validate_project",
    {
      description:
        "Validate a whole project, including parameters, wiring, commands and saved weather, without modifying it.",
      inputSchema: z.object({ project: projectSchema }),
      annotations: read,
    },
    async ({ project }) => safe(() => api("agent/validate", project)),
  );
  server.registerTool(
    "preview_project",
    {
      description:
        "Run an isolated deterministic backend preview for 0.1–600 simulated seconds, returning measurements, metrics and events. Never changes the live run. Bounded workload; one agent preview at a time.",
      inputSchema: z.object({
        project: projectSchema,
        duration: z.number().min(0.1).max(600),
      }),
      annotations: read,
    },
    async (input) => safe(() => api("agent/preview", input)),
  );
  server.registerTool(
    "save_project_draft",
    {
      description:
        "Save a validated project in the library without replacing the active project. New IDs by default; overwriting a saved draft requires explicit overwrite=true.",
      inputSchema: z.object({
        project: projectSchema,
        overwrite: z.boolean().default(false),
      }),
      annotations: write,
    },
    async (input) => safe(() => api("agent/projects", input)),
  );
  server.registerTool(
    "open_project",
    {
      description:
        "Replace the paused/stopped active project with a saved one. Resets runtime; requires user intent and fresh context.",
      inputSchema: z.object({ ...live, id: z.string() }),
      annotations: write,
    },
    async (input) =>
      safe(() => api("agent/action", { ...input, action: "open" })),
  );
  server.registerTool(
    "apply_project",
    {
      description:
        "Apply a validated definition to the paused/stopped live runtime. Resets initial conditions; does not save it. Use drafts for work not yet requested live.",
      inputSchema: z.object({ ...live, project: projectSchema }),
      annotations: write,
    },
    async (input) =>
      safe(() => api("agent/action", { ...input, action: "apply" })),
  );
  server.registerTool(
    "control_simulation",
    {
      description:
        "Start/pause/stop/reset the active simulation with user intent. Reset restores initial conditions. Speed is 0.1–20.",
      inputSchema: z.object({
        ...live,
        control: z.enum(["start", "pause", "stop", "reset"]),
        speed: z.number().min(0.1).max(20).optional(),
      }),
      annotations: write,
    },
    async (input) =>
      safe(() => api("agent/action", { ...input, action: "control" })),
  );
  server.registerTool(
    "set_equipment_command",
    {
      description:
        "Submit a Manual-mode command, respecting tag ranges, interlocks and forecast ownership. Never writes physical state directly.",
      inputSchema: z.object({
        ...live,
        id: z.string(),
        tag: z.string(),
        value: z.union([z.number().finite(), z.boolean()]),
      }),
      annotations: write,
    },
    async (input) =>
      safe(() => api("agent/action", { ...input, action: "command" })),
  );
  server.registerTool(
    "set_equipment_fault",
    {
      description:
        "Inject or clear a simulated equipment fault with user intent.",
      inputSchema: z.object({
        ...live,
        id: z.string(),
        fault: projectSchema.shape.equipment.element.shape.faults.element,
        active: z.boolean(),
      }),
      annotations: write,
    },
    async (input) =>
      safe(() => api("agent/action", { ...input, action: "fault" })),
  );
  server.registerResource(
    "project-schema",
    "twynix://schema/project-v1",
    {
      description: "Project definition JSON Schema",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(z.toJSONSchema(projectSchema)),
        },
      ],
    }),
  );
  server.registerResource(
    "building-guide",
    "twynix://guide/building",
    {
      description: "Agent workflow and simulator boundaries",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: instructions }],
    }),
  );
  server.registerPrompt(
    "build_simulation",
    {
      description:
        "Plan, build, validate, preview and save a simulation draft.",
      argsSchema: { requirements: z.string().min(1).max(4000) },
    },
    ({ requirements }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${instructions}\n\nBuild a saved draft for these requirements: ${requirements}\nReport its ID, validation, preview metrics and modeling assumptions. Leave the live simulation unchanged unless explicitly requested.`,
          },
        },
      ],
    }),
  );
  return server;
}

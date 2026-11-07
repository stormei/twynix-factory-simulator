import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { projectSchema } from "@twynix/shared-types";
import { validateProject } from "@twynix/process-graph";
import { Simulation } from "@twynix/simulation-core";
import type { ProjectStore } from "./storage";
import { setImmediate as yieldControl } from "node:timers/promises";

const guard = {
  projectId: z.string(),
  expectedRevision: z.number().int().nonnegative(),
};
const actionSchema = z.discriminatedUnion("action", [
  z.object({ ...guard, action: z.literal("open"), id: z.string() }),
  z.object({ ...guard, action: z.literal("apply"), project: projectSchema }),
  z.object({
    ...guard,
    action: z.literal("control"),
    control: z.enum(["start", "pause", "stop", "reset"]),
    speed: z.number().min(0.1).max(20).optional(),
  }),
  z.object({
    ...guard,
    action: z.literal("command"),
    id: z.string(),
    tag: z.string(),
    value: z.union([z.number().finite(), z.boolean()]),
  }),
  z.object({
    ...guard,
    action: z.literal("fault"),
    id: z.string(),
    fault: projectSchema.shape.equipment.element.shape.faults.element,
    active: z.boolean(),
  }),
]);
/** Agent APIs share the existing backend and validation; no private runtimes in MCP processes. */
export function registerAgentRoutes(
  app: FastifyInstance,
  sim: Simulation,
  store: ProjectStore,
  rebuild: () => void,
) {
  app.get("/api/agent/context", () => ({
    project: sim.project,
    snapshot: sim.snapshot(),
    concurrency: { activeRuntimes: 1, isolatedPreview: true },
  }));
  app.get("/api/agent/projects/:id", (req) =>
    store.get(z.object({ id: z.string() }).parse(req.params).id),
  );
  app.post("/api/agent/validate", (req) => {
    const project = projectSchema.parse(req.body);
    validateProject(project);
    return {
      valid: true,
      project,
      equipment: project.equipment.length,
      connections: project.connections.length,
    };
  });
  app.post("/api/agent/projects", (req) => {
    const { project, overwrite } = z
      .object({ project: projectSchema, overwrite: z.boolean().default(false) })
      .parse(req.body);
    validateProject(project);
    if (project.id === sim.project.id)
      throw Error(
        "Use the guarded apply tool to edit the active project, then save it in the editor",
      );
    if (!overwrite && store.list().some((p) => p.id === project.id))
      throw Error(
        "Project already exists; use a new ID or explicitly allow overwrite",
      );
    store.save(project);
    return { saved: true, id: project.id, activeProjectUnchanged: true };
  });
  app.post("/api/agent/action", (req) => {
    const body = actionSchema.parse(req.body);
    if (
      body.projectId !== sim.project.id ||
      body.expectedRevision !== sim.revision
    )
      throw Error(
        "Simulation changed. Read simulator context again before modifying it.",
      );
    if (body.action === "open") {
      sim.replace(store.get(body.id));
      rebuild();
    } else if (body.action === "apply") {
      sim.replace(body.project);
      rebuild();
    } else if (body.action === "control") {
      sim.control(body.control, body.speed);
    } else if (body.action === "command")
      sim.submit(body.id, body.tag, body.value, "ui");
    else sim.fault(body.id, body.fault, body.active);
    sim.event(`AI agent: ${body.action}`);
    return { project: sim.project, snapshot: sim.snapshot() };
  });
  let previewBusy = false;
  app.post("/api/agent/preview", async (req) => {
    const { project, duration } = z
      .object({
        project: projectSchema,
        duration: z.number().min(0.1).max(600),
      })
      .parse(req.body);
    validateProject(project);
    const steps = Math.floor(duration * 10);
    if (steps * Math.max(1, project.equipment.length) > 500000)
      throw Error("Preview too large; shorten it or use fewer equipment items");
    if (previewBusy)
      throw Error(
        "Another agent preview is running; try again after it completes",
      );
    previewBusy = true;
    try {
      const isolated = new Simulation(project);
      for (let i = 0; i < steps; i++) {
        const before = isolated.time;
        isolated.step();
        if (isolated.time === before) break;
        if (i % 100 === 99) await yieldControl();
      }
      return {
        simulatedTime: isolated.time,
        solar: isolated.solarMetrics(),
        production: isolated.productionMetrics(),
        weather: isolated.weatherConditions(),
        states: isolated.states,
        events: isolated.events.slice(-20),
        activeProjectUnchanged: true,
      };
    } finally {
      previewBusy = false;
    }
  });
}

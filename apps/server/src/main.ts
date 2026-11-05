import Fastify from "fastify";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { projectSchema, type Snapshot } from "@twynix/shared-types";
import { definitions } from "@twynix/equipment-models";
import { Simulation } from "@twynix/simulation-core";
import { createOpcua } from "@twynix/opcua-server";
import { demo } from "../../../examples/water-treatment.js";
import { ProjectStore } from "./storage.js";
const dir = resolve(process.env["DATA_DIR"] ?? "data");
mkdirSync(dir, { recursive: true });
const store = new ProjectStore(resolve(dir, "projects.sqlite"));
if (!store.list().length) store.save(demo);
const sim = new Simulation(store.get(store.list()[0].id));
const app = Fastify({ logger: true, bodyLimit: 2_000_000 });
const host = process.env["HOST"] ?? "127.0.0.1";
const apiToken = process.env["API_TOKEN"];
if (host !== "127.0.0.1" && host !== "localhost" && !apiToken)
  throw Error(
    "API_TOKEN is required when binding the web API to a non-loopback address",
  );
await app.register(websocket);
app.addHook("onRequest", async (req, reply) => {
  if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      return reply.code(403).send({ error: "Cross-origin requests denied" });
    }
    if (
      apiToken &&
      req.headers.authorization !== `Bearer ${apiToken}` &&
      !(
        req.url.startsWith("/ws") &&
        req.headers.cookie
          ?.split(";")
          .some(
            (v) => v.trim() === `twynix_token=${encodeURIComponent(apiToken)}`,
          )
      )
    )
      return reply.code(401).send({ error: "API token required" });
  }
});
app.setErrorHandler((error, req, reply) => {
  app.log.warn({ err: error }, "Request rejected");
  reply.code(400).send({
    error: error instanceof Error ? error.message : "Invalid request",
  });
});
const ua = await createOpcua(sim, {
  port: Number(process.env["OPCUA_PORT"] ?? 4840),
  hostname: process.env["OPCUA_HOST"] ?? "localhost",
  dev: process.env["OPCUA_DEV"] === "true",
  username: process.env["OPCUA_USER"] ?? "operator",
  password: process.env["OPCUA_PASSWORD"] ?? "",
  certificateDir: resolve(dir, "pki"),
});
app.get("/api/health", () => ({ ok: true, opcua: sim.opcua }));
app.get("/api/catalog", () => definitions);
app.get("/api/project", () => sim.project);
app.get("/api/snapshot", () => sim.snapshot());
app.get("/api/projects", () => store.list());
app.post("/api/project", async (req) => {
  const p = projectSchema.parse(req.body);
  sim.replace(p);
  ua.rebuild();
  return sim.project;
});
app.post("/api/projects/save", async () => {
  store.save(sim.project);
  sim.event("Project saved");
  return { ok: true };
});
app.post("/api/projects/open", async (req) => {
  const { id } = z.object({ id: z.string() }).parse(req.body);
  sim.replace(store.get(id));
  ua.rebuild();
  return sim.project;
});
app.delete("/api/projects/:id", async (req) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  if (id === sim.project.id)
    throw Error("Open a different project before deleting the active project");
  store.delete(id);
  return { ok: true };
});
app.post("/api/control", async (req) => {
  const body = z
    .object({
      action: z.enum(["start", "pause", "stop", "reset"]),
      speed: z.number().optional(),
    })
    .parse(req.body);
  sim.control(body.action, body.speed);
  return sim.snapshot();
});
app.post("/api/command", async (req) => {
  const body = z
    .object({
      id: z.string(),
      tag: z.string(),
      value: z.union([z.boolean(), z.number()]),
    })
    .parse(req.body);
  sim.submit(body.id, body.tag, body.value, "ui");
  return { accepted: true };
});
app.post("/api/fault", async (req) => {
  const body = z
    .object({
      id: z.string(),
      fault: projectSchema.shape.equipment.element.shape.faults.element,
      active: z.boolean(),
    })
    .parse(req.body);
  sim.fault(body.id, body.fault, body.active);
  return { ok: true };
});
const clients = new Set<import("ws").WebSocket>();
app.get("/ws", { websocket: true }, (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({ kind: "snapshot", ...sim.snapshot() }));
  socket.on("close", () => clients.delete(socket));
  socket.on("error", (error) =>
    app.log.warn({ err: error }, "WebSocket error"),
  );
});
let last = performance.now();
const clock = setInterval(() => {
  const now = performance.now();
  try {
    sim.advance((now - last) / 1000);
  } catch (error) {
    sim.control("pause");
    app.log.error({ err: error }, "Simulation failure");
    sim.event("Runtime error: simulation paused", "alarm");
  }
  last = now;
}, 20);
let previous: Snapshot = sim.snapshot();
const publish = setInterval(() => {
  const s = sim.snapshot();
  const changes = Object.fromEntries(
    Object.entries(s.states).filter(
      ([id, state]) =>
        JSON.stringify(state) !== JSON.stringify(previous.states[id]),
    ),
  );
  const payload = JSON.stringify({
    kind: "delta",
    ...s,
    states: changes,
    events: s.events.filter((e) => e.seq > (previous.events.at(-1)?.seq ?? 0)),
  });
  for (const socket of clients)
    if (socket.readyState === 1) {
      if (socket.bufferedAmount > 1_000_000)
        socket.close(1013, "Slow consumer: reconnect for a current snapshot");
      else socket.send(payload);
    }
  previous = s;
}, 200);
const web = resolve("dist/web/browser");
if (existsSync(web)) {
  await app.register(staticPlugin, { root: web });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api"))
      return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}
app.addHook("onClose", async () => {
  clearInterval(clock);
  clearInterval(publish);
  for (const s of clients) s.close();
  await ua.close();
  store.close();
});
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (!closing) {
      closing = true;
      void app.close();
    }
  });
await app.listen({ host, port: Number(process.env["PORT"] ?? 3000) });
app.log.info({ endpoint: sim.opcua.endpoint }, "Twynix runtime ready");

import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Project, Snapshot } from "@twynix/shared-types";
import { createSimulatorMcp } from "../apps/mcp/src/server";

it("independent stdio MCP client builds and previews drafts, preserves the live runtime and enforces guarded writes/auth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "twynix-mcp-"));
  const token = "mcp-test-api-token";
  const base = "http://127.0.0.1:3102";
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/server/src/main.ts"],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        DATA_DIR: dir,
        HOST: "127.0.0.1",
        PORT: "3102",
        OPCUA_DEV: "true",
        OPCUA_PORT: "14846",
        OPCUA_PASSWORD: "mcp-test-password-1234",
        API_TOKEN: token,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  child.stderr.on("data", () => {});
  const client = new Client({
    name: "twynix-independent-acceptance",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "apps/mcp/src/main.ts"],
    cwd: resolve("."),
    env: {
      PATH: process.env["PATH"] ?? "",
      TWYNIX_BACKEND_URL: base,
      API_TOKEN: token,
    },
    stderr: "pipe",
  });
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(base + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args });
    return response;
  };
  const data = <T>(response: Awaited<ReturnType<typeof call>>) =>
    (response.structuredContent as { data: T }).data;
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await request("health")).status;
          } catch {
            return 0;
          }
        },
        { timeout: 15000 },
      )
      .toBe(200);
    expect((await fetch(base + "/api/agent/context")).status).toBe(401);
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "get_equipment_catalog",
        "validate_project",
        "preview_project",
        "save_project_draft",
        "apply_project",
        "control_simulation",
      ]),
    );
    const catalog = data<
      Record<string, { defaultCommands: Record<string, number | boolean> }>
    >(await call("get_equipment_catalog"));
    expect(Object.keys(catalog)).toHaveLength(20);
    expect(catalog["pv-array"].defaultCommands["IrradianceSetpoint"]).toBe(
      1000,
    );
    expect(
      (await client.listResources()).resources.map((r) => r.uri),
    ).toContain("twynix://schema/project-v1");
    expect(
      (await client.readResource({ uri: "twynix://schema/project-v1" }))
        .contents,
    ).toHaveLength(1);
    expect(
      (
        await client.getPrompt({
          name: "build_simulation",
          arguments: { requirements: "Build a solar farm" },
        })
      ).messages,
    ).toHaveLength(1);
    const draft = data<Project>(
      await call("get_project_template", { template: "solar-farm" }),
    );
    draft.id = "agent-solar-1";
    draft.name = "Agent solar draft";
    expect(
      data<{ valid: boolean }>(
        await call("validate_project", { project: draft }),
      ).valid,
    ).toBe(true);
    expect(
      (await call("save_project_draft", { project: draft })).isError,
    ).not.toBe(true);
    expect(
      data<Project>(await call("get_saved_project", { id: draft.id })),
    ).toEqual(draft);
    expect((await call("save_project_draft", { project: draft })).isError).toBe(
      true,
    );
    const context = data<{ project: Project; snapshot: Snapshot }>(
      await call("get_simulator_context"),
    );
    const preview = data<{
      activeProjectUnchanged: boolean;
      solar: { acPower: number };
    }>(await call("preview_project", { project: draft, duration: 30 }));
    expect(preview.activeProjectUnchanged).toBe(true);
    expect(preview.solar.acPower).toBeGreaterThan(200);
    const after = data<{ project: Project; snapshot: Snapshot }>(
      await call("get_simulator_context"),
    );
    expect(after.project).toEqual(context.project);
    expect(after.snapshot.states).toEqual(context.snapshot.states);
    expect(after.snapshot.time).toBe(context.snapshot.time);
    const bad = structuredClone(draft);
    bad.equipment.find((e) => e.id === "inv1")!.parameters["ratedPower"] = -1;
    expect((await call("validate_project", { project: bad })).isError).toBe(
      true,
    );
    const open = data<{ project: Project; snapshot: Snapshot }>(
      await call("open_project", {
        projectId: context.project.id,
        expectedRevision: context.snapshot.revision,
        id: draft.id,
      }),
    );
    expect(open.project.id).toBe(draft.id);
    expect(
      (
        await call("control_simulation", {
          projectId: context.project.id,
          expectedRevision: context.snapshot.revision,
          control: "start",
        })
      ).isError,
    ).toBe(true);
    const started = data<{ snapshot: Snapshot }>(
      await call("control_simulation", {
        projectId: draft.id,
        expectedRevision: open.snapshot.revision,
        control: "start",
        speed: 5,
      }),
    );
    expect(started.snapshot.status).toBe("running");
    expect(
      (
        await call("apply_project", {
          projectId: draft.id,
          expectedRevision: started.snapshot.revision,
          project: draft,
        })
      ).isError,
    ).toBe(true);
    // Preview while a live simulation runs does not pause or reset it.
    expect(
      (await call("preview_project", { project: draft, duration: 40 })).isError,
    ).not.toBe(true);
    expect((await request("snapshot")).data.status).toBe("running");
    const latest = data<{ snapshot: Snapshot }>(
      await call("get_simulator_context"),
    );
    expect(
      (
        await call("set_equipment_command", {
          projectId: draft.id,
          expectedRevision: latest.snapshot.revision,
          id: "inv1",
          tag: "RunCommand",
          value: false,
        })
      ).isError,
    ).toBe(true); // External ownership.
    expect(
      (
        await call("set_equipment_command", {
          projectId: draft.id,
          expectedRevision: latest.snapshot.revision,
          id: "pv1",
          tag: "IrradianceSetpoint",
          value: 2000,
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await call("set_equipment_command", {
          projectId: draft.id,
          expectedRevision: latest.snapshot.revision,
          id: "pv1",
          tag: "IrradianceSetpoint",
          value: 500,
        })
      ).isError,
    ).not.toBe(true);
    const stale = data<{ snapshot: Snapshot }>(
      await call("get_simulator_context"),
    );
    await request("control", { action: "pause" });
    expect(
      (
        await call("control_simulation", {
          projectId: draft.id,
          expectedRevision: stale.snapshot.revision,
          control: "reset",
        })
      ).isError,
    ).toBe(true);
    expect(
      (await request("agent/preview", { project: draft, duration: 10000 }))
        .status,
    ).toBe(400);
  } finally {
    await client.close();
    await transport.close();
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      delay(3000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

it("MCP backend URLs reject credentials, arbitrary paths and unencrypted remote connections", () => {
  for (const url of [
    "file:///tmp/x",
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com?token=x",
  ])
    expect(() => createSimulatorMcp({ backendUrl: url })).toThrow();
});

import { test, expect } from "@playwright/test";
import { solarDemo } from "../../examples/solar-farm";

test("agent-built drafts appear in the editor without changing the active simulation", async ({
  page,
  request,
}) => {
  await request.post("/api/control", { data: { action: "stop", speed: 1 } });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
  const draft = {
    ...structuredClone(solarDemo),
    id: "agent-browser-solar",
    name: "Agent-built solar farm",
  };
  const saved = await request.post("/api/agent/projects", {
    data: { project: draft },
  });
  expect(saved.ok()).toBe(true);
  expect((await (await request.get("/api/project")).json()).id).toBe(
    "production-line",
  );
  const preview = await request.post("/api/agent/preview", {
    data: { project: draft, duration: 30 },
  });
  expect((await preview.json()).solar.acPower).toBeGreaterThan(200);
  expect((await (await request.get("/api/project")).json()).id).toBe(
    "production-line",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .getByRole("button", { name: "Agent-built solar farm", exact: true })
    .click();
  await expect(page.locator(".drawing-heading h1")).toHaveText(
    "Agent-built solar farm",
  );
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(7);
  const context = await (await request.get("/api/agent/context")).json();
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  const stale = await request.post("/api/agent/action", {
    data: {
      action: "control",
      control: "reset",
      projectId: draft.id,
      expectedRevision: context.snapshot.revision,
    },
  });
  expect(stale.status()).toBe(400);
  await expect(
    page.getByRole("button", { name: "Ⅱ Pause", exact: true }),
  ).toBeEnabled();
  await request.post("/api/control", { data: { action: "stop" } });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
});

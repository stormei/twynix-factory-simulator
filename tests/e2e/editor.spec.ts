import { test, expect } from "@playwright/test";
test("editor and headless runtime work end to end", async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await request.post("/api/control", { data: { action: "stop" } });
  await request.post("/api/projects/open", { data: { id: "water-treatment" } });
  await page.goto("/");
  await expect(
    page.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(7);
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await page.locator("g[equipmentSymbol]").filter({ hasText: "P-101" }).click();
  await expect(page.locator(".selected-heading h2")).toHaveText("P-101");
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await page.getByLabel("Control mode").selectOption("manual");
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/project")).json()).equipment.find(
          (e: { id: string }) => e.id === "pump",
        ).mode,
    )
    .toBe("manual");
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await page.getByRole("button", { name: "OFF", exact: true }).click();
  await expect
    .poll(async () => {
      const r = await request.get("/api/snapshot");
      return (await r.json()).states.tank.values.Volume;
    })
    .toBeGreaterThan(1250);
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  const paused = await (await request.get("/api/snapshot")).json();
  await expect(page.getByText("paused", { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  expect((await (await request.get("/api/snapshot")).json()).time).toBe(
    paused.time,
  );
  await page.getByRole("button", { name: "↺ Reset", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).states.tank.values
          .Volume,
    )
    .toBe(1250);
  await page.getByRole("button", { name: "Centrifugal pump" }).dblclick();
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(8);
  const newPump = page.locator("g[equipmentSymbol]").last();
  const box = await newPump.locator(".equipment-hit-area").boundingBox();
  expect(box).toBeTruthy();
  const positionBefore = (
    await (await request.get("/api/project")).json()
  ).equipment.at(-1);
  const grabX = box!.x + box!.width / 2,
    grabY = box!.y + box!.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 70, grabY + 40, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const item = (
        await (await request.get("/api/project")).json()
      ).equipment.at(-1);
      return item.x !== positionBefore.x || item.y !== positionBefore.y;
    })
    .toBe(true);
  await page.getByLabel("Label", { exact: true }).fill("Transfer pump");
  await page.getByLabel("Label", { exact: true }).press("Tab");
  await expect
    .poll(async () => {
      const p = await (await request.get("/api/project")).json();
      return p.equipment.at(-1).label;
    })
    .toBe("Transfer pump");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(8);
  await expect(page.getByText("Transfer pump", { exact: true })).toBeVisible();
  // Restore reusable demo through JSON API to isolate subsequent runtime checks.
  await request.post("/api/projects/open", { data: { id: "water-treatment" } });
  await request.post("/api/control", { data: { action: "start" } });
  await request.post("/api/command", {
    data: { id: "pump", tag: "RunCommand", value: true },
  });
  const before = (await (await request.get("/api/snapshot")).json()).time;
  await page.close();
  await new Promise((r) => setTimeout(r, 400));
  expect(
    (await (await request.get("/api/snapshot")).json()).time,
  ).toBeGreaterThan(before);
  const reconnect = await browser.newPage();
  await reconnect.goto("/");
  await expect(
    reconnect.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  await reconnect.screenshot({
    path: "test-results/twynix-workspace.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await reconnect.close();
});

test("native drag/drop, typed port connections, undo, and rejected edits", async ({
  page,
  request,
}) => {
  await request.post("/api/control", { data: { action: "stop" } });
  await page.goto("/");
  await expect(
    page.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ New", exact: true }).click();
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(0);
  const canvas = page.locator("svg.canvas");
  await page
    .getByRole("button", { name: "Water source", exact: true })
    .dragTo(canvas, { targetPosition: { x: 150, y: 200 } });
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Centrifugal pump", exact: true })
    .dragTo(canvas, { targetPosition: { x: 400, y: 200 } });
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(2);
  const source = page.locator("g[equipmentSymbol]").nth(0),
    pump = page.locator("g[equipmentSymbol]").nth(1);
  await source.locator(".port").click();
  await pump.locator(".port").first().click();
  await expect(page.locator("path.connection")).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/project")).json()).connections.length,
    )
    .toBe(1);
  // A second output-to-output connection must roll back without disturbing the valid edge.
  await pump.locator(".port").last().click();
  await source.locator(".port").click();
  await expect(page.locator("footer")).toContainText("Incompatible ports");
  await expect(page.locator("path.connection")).toHaveCount(1);
  await page.getByRole("button", { name: "↶", exact: true }).click();
  await expect(page.locator("path.connection")).toHaveCount(0);
  await page.getByRole("button", { name: "↷", exact: true }).click();
  await expect(page.locator("path.connection")).toHaveCount(1);
});

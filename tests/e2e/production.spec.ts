import { test, expect } from "@playwright/test";
test("graphical production line, live I/O, fault schedules and persisted comparisons", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await request.post("/api/control", { data: { action: "stop" } });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
  await page.goto("/");
  await expect(
    page.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(6);
  await expect(page.locator(".drawing-heading h1")).toHaveText(
    "Precision Packaging Line",
  );
  await expect(page.locator(".library-thumbnail")).toHaveCount(20);
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await request.post("/api/control", { data: { action: "start", speed: 20 } });
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).production
          .completed,
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "I/O signals", exact: true }).click();
  await page.getByLabel("Search signals").fill("CV-101 RunCommand");
  await expect(page.locator(".io-table tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Toggle CV-101 RunCommand", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/project")).json()).equipment.find(
          (e: { id: string }) => e.id === "conveyor",
        ).commands.RunCommand,
    )
    .toBe(false);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).states.conveyor
          .values.RunFeedback,
    )
    .toBe(false);
  await page
    .getByRole("button", { name: "Toggle CV-101 RunCommand", exact: true })
    .click();
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await page.getByLabel("Scenario equipment").selectOption("machine");
  await page.getByLabel("Scenario fault").selectOption("trip");
  await page.getByLabel("Fault activation time").fill("15");
  await page.getByLabel("Fault clear time").fill("25");
  await page
    .getByRole("button", { name: "＋ Add fault window", exact: true })
    .click();
  await expect(page.locator(".scenario-timeline>div")).toHaveCount(2);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/project")).json()).scenarios.length,
    )
    .toBe(2);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByLabel("Experiment duration").fill("120");
  await page
    .getByRole("button", { name: "▶ Run comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-table tbody tr")).toHaveCount(3);
  const results = await (await request.get("/api/experiments")).json();
  expect(results[0].results[0].metrics.completed).toBeGreaterThan(10);
  expect(results[0].results[2].metrics.completed).toBeGreaterThan(
    results[0].results[0].metrics.completed,
  );
  expect(results[0].project.scenarios).toHaveLength(2);
  await page.screenshot({
    path: "test-results/production-experiments.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await expect(page.locator(".comparison-table tbody tr")).toHaveCount(3);
  await expect(page.locator(".scenario-timeline>div")).toHaveCount(2);
  // Ensure a background comparison never resets or edits the active runtime.
  await request.post("/api/control", { data: { action: "start", speed: 1 } });
  const before = (await (await request.get("/api/snapshot")).json()).time;
  await page
    .getByRole("button", { name: "▶ Run comparison", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "▶ Run comparison", exact: true }),
  ).toBeEnabled();
  const after = await (await request.get("/api/snapshot")).json();
  expect(after.status).toBe("running");
  expect(after.time).toBeGreaterThanOrEqual(before);
  await request.post("/api/control", { data: { action: "start", speed: 20 } });
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).production
          .completed,
    )
    .toBeGreaterThan(2);
  await request.post("/api/control", { data: { action: "pause" } });
  await page
    .getByRole("button", { name: "Process drawing", exact: true })
    .click();
  await page.getByRole("button", { name: "Performance", exact: true }).click();
  await expect(page.locator(".performance-table tbody tr")).toHaveCount(6);
  await page.screenshot({
    path: "test-results/production-workspace.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  // Restore the reusable example for other test files.
  await request.post("/api/project", {
    data: { ...results[0].project, scenarios: [] },
  });
  await request.post("/api/projects/save", { data: {} });
});

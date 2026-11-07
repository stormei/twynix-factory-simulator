import { test, expect } from "@playwright/test";

test("solar farm symbols, live energy readings, OPC UA tags and shading controls", async ({
  page,
  request,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await request.post("/api/control", { data: { action: "stop", speed: 1 } });
  await request.post("/api/projects/open", { data: { id: "solar-farm" } });
  const original = await (await request.get("/api/project")).json();
  await page.goto("/");
  await expect(
    page.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("g[equipmentSymbol]")).toHaveCount(7);
  await expect(page.locator(".solar-module")).toHaveCount(24); // Three fields plus library preview.
  await expect(page.locator(".connection.electrical-line")).toHaveCount(6);
  await expect(page.getByLabel("Solar farm metrics")).toContainText(
    "Inverters online",
  );
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await request.post("/api/control", { data: { action: "start", speed: 20 } });
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).solar.online,
    )
    .toBe(3);
  await expect(page.getByLabel("Solar farm metrics")).toContainText("3 / 3");
  await expect(
    page.getByLabel("Equipment library", { exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Full-screen live view", exact: true })
    .click();
  await expect(
    page.getByLabel("Equipment properties", { exact: true }),
  ).toBeHidden();
  await page.screenshot({
    path: "test-results/solar-farm-live.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Exit full-screen", exact: true })
    .click();
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await page.locator('g[equipmentSymbol][data-equipment-id="inv2"]').click();
  await page.screenshot({
    path: "test-results/solar-farm-workspace.png",
    fullPage: true,
  });
  expect(
    await page
      .locator('g[equipmentSymbol][data-equipment-id="pv1"] .symbol-reading')
      .evaluate((reading) => {
        const next = document.querySelector(
          'g[equipmentSymbol][data-equipment-id="pv2"] .equipment-tag-bg',
        );
        return (
          !!next &&
          reading.getBoundingClientRect().bottom <
            next.getBoundingClientRect().top
        );
      }),
  ).toBe(true);
  await page.getByRole("button", { name: "I/O signals", exact: true }).click();
  await page.getByLabel("Search signals").fill("INV-101 ACPower");
  await expect(page.locator(".io-table tbody tr")).toHaveCount(1);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator(".copy-node").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "ns=2;s=project/solar-farm/equipment/inv1/ACPower",
  );
  await page.getByLabel("Search signals").fill("INV-101 PowerLimitPercent");
  await expect(
    page.getByLabel("INV-101 PowerLimitPercent", { exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Process drawing", exact: true })
    .click();
  await page.locator('g[equipmentSymbol][data-equipment-id="pv1"]').click();
  await expect(
    page.getByLabel("IrradianceSetpoint", { exact: true }),
  ).toBeEnabled();
  await page.getByLabel("ShadingPercent", { exact: true }).fill("100");
  await page.getByLabel("ShadingPercent", { exact: true }).press("Tab");
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/project")).json()).equipment.find(
          (e: { id: string }) => e.id === "pv1",
        ).commands.ShadingPercent,
    )
    .toBe(100);
  await request.post("/api/control", { data: { action: "start", speed: 20 } });
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).states.inv1.status,
    )
    .toBe("sleeping");
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).solar.online,
    )
    .toBe(2);
  await page
    .getByRole("button", { name: "Full-screen live view", exact: true })
    .click();
  await expect(
    page.getByLabel("Equipment properties", { exact: true }),
  ).toBeHidden();
  await expect(page.getByLabel("Solar farm metrics")).toBeVisible();
  await page.screenshot({
    path: "test-results/solar-farm-shading-live.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Exit full-screen", exact: true })
    .click();
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await page.locator('g[equipmentSymbol][data-equipment-id="inv2"]').click();
  await page.screenshot({
    path: "test-results/solar-farm-shading-workspace.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await request.post("/api/project", { data: original });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
});

import { test, expect, type Page } from "@playwright/test";
async function expectEquipmentInView(page: Page) {
  await expect
    .poll(() =>
      page.locator("svg.canvas").evaluate((svg) => {
        const canvas = svg.getBoundingClientRect();
        return [...svg.querySelectorAll("g[equipmentSymbol] .glyph-art")].every(
          (g) => {
            const b = g.getBoundingClientRect();
            return (
              b.left >= canvas.left &&
              b.right <= canvas.right &&
              b.top >= canvas.top + 70 &&
              b.bottom <= canvas.bottom - 20
            );
          },
        );
      }),
    )
    .toBe(true);
}
test("larger symbols and moving products use the full live canvas; palette returns on pause and stop", async ({
  page,
  request,
}) => {
  await request.post("/api/control", { data: { action: "stop", speed: 1 } });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
  const original = await (await request.get("/api/project")).json();
  await page.goto("/");
  const palette = page.getByRole("complementary", {
    name: "Equipment library",
  });
  await expect(palette).toBeVisible();
  const conveyor = page.locator(
    'g[equipmentSymbol][data-equipment-id="conveyor"]',
  );
  const art = conveyor.locator(".glyph-art");
  await expect
    .poll(async () => (await art.boundingBox())?.width ?? 0)
    .toBeGreaterThan(130);
  const editorWidth = (await page.locator("svg.canvas").boundingBox())!.width;
  const editorSymbolWidth = (await art.boundingBox())!.width;
  await expectEquipmentInView(page);
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await expect(palette).toBeHidden();
  await expect
    .poll(
      async () => (await page.locator("svg.canvas").boundingBox())?.width ?? 0,
    )
    .toBeGreaterThan(editorWidth + 200);
  await expect
    .poll(async () => (await art.boundingBox())?.width ?? 0)
    .toBeGreaterThan(editorSymbolWidth * 1.12);
  await expectEquipmentInView(page);
  const parcel = conveyor.locator(".glyph-art use").first();
  await expect(parcel).toBeVisible();
  const x = Number(await parcel.getAttribute("x"));
  await expect
    .poll(async () => Number(await parcel.getAttribute("x")))
    .toBeGreaterThan(x + 3);
  // Scaled connection paths must terminate at the actual visible port centers.
  const distances = await page.locator("svg.canvas").evaluate((svg) => {
    const path = svg.querySelector<SVGPathElement>("path.connection")!;
    const source = svg.querySelector<SVGCircleElement>(
      '[data-equipment-id="feeder"] .port',
    )!;
    const target = svg.querySelector<SVGCircleElement>(
      '[data-equipment-id="conveyor"] .port',
    )!;
    const screen = (p: DOMPoint, m: DOMMatrix | null) =>
      m ? p.matrixTransform(m) : p;
    const a = screen(path.getPointAtLength(0), path.getScreenCTM());
    const b = screen(
      path.getPointAtLength(path.getTotalLength()),
      path.getScreenCTM(),
    );
    const sa = screen(
      new DOMPoint(source.cx.baseVal.value, source.cy.baseVal.value),
      source.getScreenCTM(),
    );
    const sb = screen(
      new DOMPoint(target.cx.baseVal.value, target.cy.baseVal.value),
      target.getScreenCTM(),
    );
    return [
      Math.hypot(a.x - sa.x, a.y - sa.y),
      Math.hypot(b.x - sb.x, b.y - sb.y),
    ];
  });
  expect(distances.every((d) => d < 1)).toBe(true);
  await request.post("/api/control", { data: { action: "start", speed: 20 } });
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).production
          .completed,
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/production-live-large.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectEquipmentInView(page);
  await expect(palette).toBeHidden();
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await expect(palette).toBeVisible();
  await expectEquipmentInView(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await expect(palette).toBeHidden();
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await expect(palette).toBeVisible();
  await expectEquipmentInView(page);
  const current = await (await request.get("/api/project")).json();
  expect(
    current.equipment.map((e: { id: string; x: number; y: number }) => [
      e.id,
      e.x,
      e.y,
    ]),
  ).toEqual(
    original.equipment.map((e: { id: string; x: number; y: number }) => [
      e.id,
      e.x,
      e.y,
    ]),
  );
});

test("symbol-size slider updates live graphics and connections, remembers size, and never edits the project", async ({
  page,
  request,
}) => {
  await request.post("/api/control", { data: { action: "stop", speed: 1 } });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
  const original = await (await request.get("/api/project")).json();
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Equipment symbol size" });
  await expect(slider).toHaveValue("135");
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("80");
  await expect(page.locator(".symbol-size-control output")).toHaveText("80%");
  await expectEquipmentInView(page);
  const art = page.locator('[data-equipment-id="conveyor"] .glyph-art');
  const small = (await art.boundingBox())!.width;
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await expect(page.locator(".library")).toBeHidden();
  await slider.focus();
  await slider.press("End");
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("155");
  await expect(page.locator(".symbol-size-control output")).toHaveText("155%");
  await expect
    .poll(async () => (await art.boundingBox())?.width ?? 0)
    .toBeGreaterThan(small * 1.4);
  await expectEquipmentInView(page);
  const distance = await page.locator("svg.canvas").evaluate((svg) => {
    const path = svg.querySelector<SVGPathElement>("path.connection")!;
    const port = svg.querySelector<SVGCircleElement>(
      '[data-equipment-id="feeder"] .port',
    )!;
    const a = path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!);
    const b = new DOMPoint(
      port.cx.baseVal.value,
      port.cy.baseVal.value,
    ).matrixTransform(port.getScreenCTM()!);
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  expect(distance).toBeLessThan(1);
  const before = (await (await request.get("/api/snapshot")).json()).time;
  await page.reload();
  await expect(slider).toHaveValue("155");
  await expect(page.locator(".library")).toBeHidden();
  const after = await (await request.get("/api/snapshot")).json();
  expect(after.status).toBe("running");
  expect(after.time).toBeGreaterThanOrEqual(before);
  expect(await (await request.get("/api/project")).json()).toEqual(original);
  await page.evaluate(() =>
    localStorage.setItem("twynix-equipment-size", "9999"),
  );
  await page.reload();
  await expect(slider).toHaveValue("135");
  await request.post("/api/control", { data: { action: "stop" } });
});

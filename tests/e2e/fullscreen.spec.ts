import { test, expect } from "@playwright/test";
test("full-screen live view hides panels, fills the screen, preserves controls and restores on exit", async ({
  page,
  request,
}) => {
  await request.post("/api/control", { data: { action: "stop", speed: 1 } });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
  const project = await (await request.get("/api/project")).json();
  await page.goto("/");
  await expect(
    page.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await request.post("/api/control", { data: { action: "start", speed: 20 } });
  await page
    .getByRole("button", { name: "Full-screen live view", exact: true })
    .click();
  await expect(page.locator("app-root")).toHaveClass("full-screen-live");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.fullscreenElement === document.documentElement,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("complementary", {
      name: "Equipment properties",
      includeHidden: true,
    }),
  ).toBeHidden();
  await expect(page.locator(".diagnostics")).toBeHidden();
  await expect(page.locator(".library")).toBeHidden();
  await expect(page.locator(".titlebar")).toBeHidden();
  await expect(page.locator("footer")).toBeHidden();
  await expect(
    page.getByRole("slider", { name: "Equipment symbol size" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ⅱ Pause", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Exit full-screen", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("svg.canvas").evaluate((svg) => {
        const r = svg.getBoundingClientRect();
        return (
          r.width / window.innerWidth > 0.98 &&
          r.height / window.innerHeight > 0.7
        );
      }),
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).production
          .completed,
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/full-screen-live.png",
    fullPage: true,
  });
  // The live-view toggle does not write equipment, reset physical state, or stop execution.
  const before = (await (await request.get("/api/snapshot")).json()).time;
  await page
    .getByRole("button", { name: "Exit full-screen", exact: true })
    .click();
  await expect(page.locator("app-root")).not.toHaveClass("full-screen-live");
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  await expect(page.locator(".properties")).toBeVisible();
  await expect(page.locator(".diagnostics")).toBeVisible();
  const after = await (await request.get("/api/snapshot")).json();
  expect(after.status).toBe("running");
  expect(after.time).toBeGreaterThanOrEqual(before);
  expect(await (await request.get("/api/project")).json()).toEqual(project);
  await page
    .getByRole("button", { name: "Full-screen live view", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".properties")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Full-screen live view", exact: true }),
  ).toBeFocused();
  // Browser-managed fullscreen exits also restore the editor.
  await page
    .getByRole("button", { name: "Full-screen live view", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator(".properties")).toBeVisible();
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await expect(page.locator(".library")).toBeVisible();
});

test("expanded live layout works without native fullscreen and restores the previous workspace", async ({
  page,
  request,
}) => {
  await request.post("/api/control", { data: { action: "stop", speed: 1 } });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
  await page.addInitScript(() =>
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: () =>
        Promise.reject(
          new DOMException(
            "Unavailable in this environment",
            "NotAllowedError",
          ),
        ),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I/O signals", exact: true }).click();
  await expect(page.locator(".io-panel")).toBeVisible();
  const before = await (await request.get("/api/snapshot")).json();
  await page
    .getByRole("button", { name: "Full-screen live view", exact: true })
    .click();
  await expect(page.locator(".drawing")).toBeVisible();
  await expect(page.locator(".properties")).toBeHidden();
  await expect(page.locator(".diagnostics")).toBeHidden();
  await expect(page.locator(".library")).toBeHidden();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await page.keyboard.press("Delete");
  expect(
    (await (await request.get("/api/project")).json()).equipment,
  ).toHaveLength(6);
  await page.getByRole("slider", { name: "Equipment symbol size" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".io-panel")).toBeVisible();
  await expect(page.locator(".properties")).toBeVisible();
  await expect(page.locator(".library")).toBeVisible();
  await expect(page.locator(".diagnostics")).toBeVisible();
  const after = await (await request.get("/api/snapshot")).json();
  expect(after.status).toBe(before.status);
  expect(after.time).toBe(before.time);
});

import { test, expect } from "@playwright/test";
import { weatherFixture } from "../weather-fixture";

test("site search, saved forecast replay, weather-owned inputs and offline project reload", async ({
  page,
  request,
}) => {
  await request.post("/api/control", { data: { action: "stop", speed: 1 } });
  await request.post("/api/projects/open", { data: { id: "solar-farm" } });
  const original = await (await request.get("/api/project")).json();
  await page.route("**/api/weather/locations?*", (route) =>
    route.fulfill({
      json: [{ name: "Oslo, Norway", latitude: 59.9139, longitude: 10.7522 }],
    }),
  );
  await page.route("**/api/weather/forecast", async (route) => {
    expect(route.request().postDataJSON()).toEqual(weatherFixture.site);
    await route.fulfill({ json: weatherFixture });
  });
  await page.goto("/");
  await expect(
    page.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Weather & location", exact: true })
    .click();
  await page.getByLabel("Search weather location").fill("Oslo");
  await page
    .getByRole("button", { name: "Search location", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Oslo, Norway · 59.9139, 10.7522",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Weather latitude")).toHaveValue("59.9139");
  await expect(page.getByLabel("Panel azimuth")).toHaveValue("180");
  await page
    .getByRole("button", { name: "Load 7-day forecast", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/project")).json()).weather?.mode,
    )
    .toBe("forecast");
  await expect(page.locator(".weather-table tbody tr")).toHaveCount(12);
  await expect(page.getByLabel("Forecast start time")).toHaveValue(
    "2026-06-21T10:00",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.screenshot({
    path: "test-results/solar-weather-settings.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await request.post("/api/control", { data: { action: "start", speed: 20 } });
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/snapshot")).json()).solar.online,
    )
    .toBe(3);
  await expect(page.getByLabel("Live weather")).toContainText("Oslo, Norway");
  await expect(
    page.getByRole("button", { name: "Load 7-day forecast", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Process drawing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Full-screen live view", exact: true })
    .click();
  await expect(page.getByLabel("Live weather")).toBeVisible();
  await page.screenshot({
    path: "test-results/solar-weather-live.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Exit full-screen", exact: true })
    .click();
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await page.locator('g[equipmentSymbol][data-equipment-id="pv1"]').click();
  await expect(
    page.getByLabel("IrradianceSetpoint", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("AmbientTemperature", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("ShadingPercent", { exact: true }),
  ).toBeEnabled();
  // Reload and reopen from storage while blocking every weather download.
  await page.route("**/api/weather/**", (route) => route.abort());
  await request.post("/api/projects/open", { data: { id: "production-line" } });
  await request.post("/api/projects/open", { data: { id: "solar-farm" } });
  await page.reload();
  await page
    .getByRole("button", { name: "Weather & location", exact: true })
    .click();
  await expect(page.getByLabel("Weather location name")).toHaveValue(
    "Oslo, Norway",
  );
  await expect(page.locator(".weather-table tbody tr")).toHaveCount(12);
  await page.getByLabel("Forecast start time").fill("2026-06-21T12:00");
  await page.getByLabel("Forecast start time").press("Tab");
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/project")).json()).weather?.startTime,
    )
    .toBe("2026-06-21T12:00:00.000Z");
  await page.getByLabel("Weather source").selectOption("manual");
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/project")).json()).weather?.mode,
    )
    .toBe("manual");
  await expect(page.getByLabel("Live weather")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Process drawing", exact: true })
    .click();
  await page.locator('g[equipmentSymbol][data-equipment-id="pv1"]').click();
  await expect(
    page.getByLabel("IrradianceSetpoint", { exact: true }),
  ).toBeEnabled();
  await request.post("/api/project", { data: original });
  await request.post("/api/projects/save");
});

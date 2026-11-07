import { test, expect } from "@playwright/test";
test("workbench library categories, keyboard search, and running configuration locks", async ({
  page,
  request,
}) => {
  await request.post("/api/control", { data: { action: "stop", speed: 1 } });
  await request.post("/api/projects/open", { data: { id: "production-line" } });
  const original = await (await request.get("/api/project")).json();
  await page.goto("/");
  await expect(
    page.getByText("Runtime connected", { exact: true }),
  ).toBeVisible();
  const category = page.getByRole("button", {
    name: "Manufacturing equipment",
    exact: true,
  });
  await expect(category).toHaveAttribute("aria-expanded", "true");
  await category.click();
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "Product feeder", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("textbox", { name: "Search equipment" });
  await expect(search).toBeFocused();
  await search.fill("motor");
  await expect(page.locator(".library-thumbnail")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Electric motor", exact: true }),
  ).toBeVisible();
  await expect(category).toHaveAttribute("aria-expanded", "true");
  await search.clear();
  await expect(category).toHaveAttribute("aria-expanded", "false");
  await category.click();
  await expect(page.locator(".library-thumbnail")).toHaveCount(20);
  await page
    .locator('g[equipmentSymbol][data-equipment-id="machine"]')
    .click();
  const tag = page.getByLabel("Equipment tag", { exact: true });
  const cycle = page.getByLabel("Cycle time (s)", { exact: true });
  await expect(tag).toBeEnabled();
  await expect(cycle).toBeEnabled();
  await expect(page.locator(".fault-grid button")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Ⅱ Pause", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "▶ Start", exact: true }).click();
  await expect(tag).toBeDisabled();
  await expect(cycle).toBeDisabled();
  await expect(page.getByLabel("Control mode")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "ON", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".property-edit-state")).toHaveText(
    "Pause to edit configuration.",
  );
  await page.getByRole("button", { name: "Ⅱ Pause", exact: true }).click();
  await expect(tag).toBeEnabled();
  await expect(cycle).toBeEnabled();
  await expect(page.locator(".event-columns")).toContainText("Message");
  await page.screenshot({
    path: "test-results/engineering-workbench.png",
    fullPage: true,
  });
  expect(await (await request.get("/api/project")).json()).toEqual(original);
});

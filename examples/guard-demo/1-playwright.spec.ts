import { test, expect } from "@playwright/test";

test("places an order (import from @playwright/test)", async ({ page }) => {
  await page.goto(process.env.BASE_URL!);
  await page.getByLabel("Name", { exact: true }).fill("Ada");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("status")).toContainText("Order placed");
});

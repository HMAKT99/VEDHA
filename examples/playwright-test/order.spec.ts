// Run with: BASE_URL=http://localhost:3000 npx playwright test examples/playwright-test
import { test } from "@vedhajs/playwright-test";

const base = process.env.BASE_URL ?? "http://localhost:3000";

test("place an order", async ({ vedha }) => {
  await vedha.verify({
    id: "open",
    intent: "open the form",
    op: "goto",
    value: base + "/",
    postconditions: [{ type: "state", target: { label: "Name", exact: true }, state: "visible" }],
  });
  await vedha.verify({
    id: "name",
    intent: "enter name",
    op: "fill",
    target: { label: "Name", exact: true },
    value: "Ada",
  });
  await vedha.verify({
    id: "submit",
    intent: "place the order",
    op: "click",
    target: { role: "button", name: "Place order" },
    mutating: true,
    // The text can say "Order placed" while the server returned 500; Vedha's page-health check fails
    // the step in that case even though only the text is declared here.
    postconditions: [{ type: "text", target: { role: "status" }, contains: "Order placed" }],
  });
});

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: generated.spec.ts >> heading
- Location: generated.spec.ts:2:1

# Error details

```
Error: page.goto: net::ERR_UNSAFE_PORT at http://127.0.0.1:9/
Call log:
  - navigating to "http://127.0.0.1:9/", waiting until "load"

```

# Test source

```ts
  1 | import { test, expect } from "@playwright/test";
  2 | test("heading", async ({ page }) => {
> 3 |   await page.goto("/");
    |              ^ Error: page.goto: net::ERR_UNSAFE_PORT at http://127.0.0.1:9/
  4 |   await expect(page.getByRole("heading", { name: "New order" })).toBeVisible({ timeout: 3000 });
  5 | });
  6 |
```

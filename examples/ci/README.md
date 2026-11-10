# Guard mode in CI

A silent 500 does the most damage in CI: the suite is green, the change merges, and the write path is broken. Guard mode needs no CI-specific setup; the workflow is the standard Playwright one.

1. `npm install -D @vedhajs/playwright-test`
2. In your tests, change `from "@playwright/test"` to `from "@vedhajs/playwright-test"` (a find-and-replace across the test folder).
3. Copy [`playwright.yml`](playwright.yml) to `.github/workflows/` (or keep your existing workflow; it works unchanged).

A test that passes its own checks but saw a 5xx, or a write that failed outright, fails with:

```text
Error: Vedha guard: the test's own checks passed, but the app reported a problem:
  - POST /api/orders returned 500
```

The findings are attached to the test as `vedha-guard.json`, so they appear in the HTML report the workflow uploads. Tests that expect a server error can opt out with `test.use({ vedhaGuard: false })`; see [guard mode](../../README.md#migrating-a-playwright-test) for `strict` and `ignore`.

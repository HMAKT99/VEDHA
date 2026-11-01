# Guard-mode demo: one import, a passing test that should have failed

Two copies of the same ordinary Playwright test. The only difference is the import:

```ts
import { test, expect } from "@playwright/test"; //        1-playwright.spec.ts
import { test, expect } from "@vedhajs/playwright-test"; // 2-vedha.spec.ts
```

They run against an order form whose API returns 500 and stores nothing while the page still says "Order placed":

```bash
pnpm install && pnpm build
npx tsx examples/guard-demo/run.ts
```

```text
  ✓  1 1-playwright.spec.ts › places an order (import from @playwright/test)
  ✘  2 2-vedha.spec.ts › places an order (import from @vedhajs/playwright-test)

    Error: Vedha guard: the test's own checks passed, but the app reported a problem:
      - POST /api/orders returned 500
```

On a healthy app both pass. The Playwright test would catch this too with a hand-written network assertion; guard mode adds that check to every test without one. To record the GIF: `vhs examples/guard-demo/demo.tape`.

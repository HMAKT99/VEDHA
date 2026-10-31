# Demo: the page says "Order placed", the server stored nothing

The order form here has a seeded defect: `POST /api/orders` returns 500 and stores nothing, but the page still shows "Order placed". The same flow with the same check (wait for "Order placed") is run by plain Playwright and by Vedha.

```bash
pnpm install && pnpm build
npx tsx examples/demo/run.ts
```

```text
Playwright  PASS   "Order placed" is on the page
Vedha       FAILED declared checks passed, but the page reported: POST /api/orders returned 500
Server      0 orders stored
```

Vedha fails the step without any extra check from you: the click was marked `mutating`, so Vedha checked the requests it sent (see [`typical.json`](typical.json)). A Playwright test catches this too if you add a network assertion by hand; the benchmarks found that typical tests don't (0 of 140 seeded defects with text/URL-only checks, against 60 of 140 for Vedha).

To record it as a GIF: install [VHS](https://github.com/charmbracelet/vhs), then `vhs examples/demo/demo.tape`.

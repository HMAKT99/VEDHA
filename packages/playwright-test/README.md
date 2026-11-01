# @vedhajs/playwright-test

Find the Playwright tests that pass while your app is broken. Change one import:

```ts
// before
import { test, expect } from "@playwright/test";
// after
import { test, expect } from "@vedhajs/playwright-test";
```

Your tests run unchanged. Guard mode then fails a test whose own checks passed if the app answered a request with a 5xx, or a write request (POST/PUT/PATCH/DELETE) failed: the page said "Saved", the server didn't. 4xx answers to writes and uncaught page errors are reported as warnings. Requests to other sites are not watched. Findings are attached to the test as `vedha-guard.json`.

```ts
test.use({ vedhaGuard: "strict" }); // 4xx writes and page errors fail too
test.use({ vedhaGuard: { ignore: ["/api/flaky"], hosts: ["api.other-domain.com"] } });
test.use({ vedhaGuard: false }); // off, for tests that expect a server error
```

For steps that must hold, the `vedha` fixture runs checked steps (`vedha.verify(...)`) with recovery and a failure bundle.

Part of [Vedha](https://github.com/HMAKT99/VEDHA), browser testing on Playwright that checks each action really happened. See the main README for usage, benchmarks and limits.

License: Apache-2.0.

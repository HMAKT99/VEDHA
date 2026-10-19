# Migration and compatibility with Playwright

## Principles

1. **No fork, no wrapper rebrand:** Vedha owns ActionSpec/verification/recovery/promotion/bundles; Playwright is the pluggable execution substrate (ADR-0001).
2. **Additive adoption:** an Vedha `Session` can be created from an existing Playwright `Page` (`Session.fromPage(page, policy)`), so existing Playwright Test suites can adopt one verified step at a time.
3. **Promoted tests are plain Playwright Test specs** (no Vedha runtime dependency required to _run_ them), so the output is reviewable and CI-native.

## Mapping

| Playwright                                                                                                   | Vedha                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `await page.getByRole('button',{name:'Save'}).click(); await expect(page.getByText('Saved')).toBeVisible();` | `{op:'click', target:{role:'button',name:'Save'}, postconditions:[{type:'text',target:{text:'Saved'},visible:true}, {type:'network',method:'POST',url:'/api/orders',status:'2xx'}]}` |
| `page.addLocatorHandler(overlay, dismiss)`                                                                   | `recovery.ladder: dismissKnown` entries; each use is recorded in a `RecoveryRecord`                                                                                                  |
| `expect.poll` / `toPass`                                                                                     | verifier with retry window (same polling primitive via adapter)                                                                                                                      |
| trace.zip + `error-context.md`                                                                               | `FailureBundle` (can reference a Playwright trace when enabled)                                                                                                                      |
| MCP `browser_snapshot`                                                                                       | `observe({level:'outline'})` (same `[ref=eN]` vocabulary)                                                                                                                            |
| MCP `browser_verify_*`                                                                                       | postconditions evaluated by the runner, not the actor                                                                                                                                |

## Compatibility matrix

- Browsers: whatever the Playwright adapter launches (Chromium verified in MVP; Firefox/WebKit untested - Q2).
- Playwright versions: developed against 1.64.x runtime; `peerDependency` range recorded after testing (Q1).
- Test runners: generated specs target `@playwright/test`; Vedha's own tests use Vitest/node:test.

## Migration example

See `README.md` "Migrating a Playwright test" for a before/after.

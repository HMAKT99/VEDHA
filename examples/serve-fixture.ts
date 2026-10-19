// Starts the benchmark fixture app so the README examples can be run locally:
//   npx tsx examples/serve-fixture.ts            -> healthy app
//   npx tsx examples/serve-fixture.ts silent     -> app with the seeded "silent 500" defect
import { ShopServer } from "../benchmarks/fixtures/shop.js";

const bug = process.argv[2] === "silent" ? ("silent" as const) : undefined;
const s = new ShopServer({ bug });
const url = await s.start();
console.log(`fixture app listening on ${url}  (Ctrl-C to stop)`);

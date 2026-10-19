import { VedhaDriver } from "./vedha-driver.js";
import { PwHealNaive, PwStrong, PwTest, PwTrust } from "./playwright-drivers.js";
import type { Driver } from "./types.js";

export const ALL_DRIVERS: Array<() => Driver> = [
  () => new PwTrust(),
  () => new PwTest(),
  () => new PwStrong(),
  () => new PwHealNaive(),
  () => new VedhaDriver(),
];

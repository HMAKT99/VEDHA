import { SelStrong, SelTrust } from "./selenium-drivers.js";
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

/** Selenium baselines are opt-in (`--drivers sel-trust,sel-strong`): they need a local Chrome and chromedriver. */
export const SELENIUM_DRIVERS: Array<() => Driver> = [() => new SelTrust(), () => new SelStrong()];

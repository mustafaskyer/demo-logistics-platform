import { afterAll } from "bun:test";
import { stopHarness } from "./harness.js";

afterAll(async () => {
  await stopHarness();
}, 60_000);

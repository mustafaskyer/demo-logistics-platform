import { expect, test } from "bun:test";
import { startHarness } from "../support/harness.js";

test("GET /hello", async () => {
  const { baseUrl } = await startHarness();
  const response = await fetch(`${baseUrl}/hello?name=Mustafa`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ message: "Hello, Mustafa!" });
}, 120_000);

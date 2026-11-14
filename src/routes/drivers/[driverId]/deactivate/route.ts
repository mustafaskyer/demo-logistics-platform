/** Deactivates a driver and releases their vehicle. */
import { defineRoute, http } from "relkit/routes";
import drivers from "@app/services/drivers/service.js";

export const POST = defineRoute({
  target: drivers.deactivateDriver,
  request: http.input({ driverId: http.path("driverId") }),
});

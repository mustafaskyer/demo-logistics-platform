/** Reactivates a driver. */
import { defineRoute, http } from "relkit/routes";
import drivers from "@app/services/drivers/service.js";

export const POST = defineRoute({
  target: drivers.activateDriver,
  request: http.input({ driverId: http.path("driverId") }),
});

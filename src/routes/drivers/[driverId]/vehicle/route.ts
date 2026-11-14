/** Releases the driver's current vehicle. */
import { defineRoute, http } from "relkit/routes";
import drivers from "@app/services/drivers/service.js";

export const DELETE = defineRoute({
  target: drivers.unassignVehicle,
  request: http.input({ driverId: http.path("driverId") }),
});

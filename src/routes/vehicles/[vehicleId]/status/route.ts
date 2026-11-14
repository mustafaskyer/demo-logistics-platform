/** Moves a vehicle between active and maintenance. */
import { defineRoute, http } from "relkit/routes";
import fleet from "@app/services/fleet/service.js";

export const PUT = defineRoute({
  target: fleet.changeVehicleStatus,
  request: http.input({ vehicleId: http.path("vehicleId"), status: http.body("status") }),
});

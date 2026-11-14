/** Permanently retires a vehicle. */
import { defineRoute, http } from "relkit/routes";
import fleet from "@app/services/fleet/service.js";

export const POST = defineRoute({
  target: fleet.retireVehicle,
  request: http.input({ vehicleId: http.path("vehicleId") }),
});

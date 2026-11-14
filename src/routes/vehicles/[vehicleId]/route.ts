/** One vehicle: read and update. */
import { defineRoute, http } from "relkit/routes";
import fleet from "@app/services/fleet/service.js";

export const GET = defineRoute({
  target: fleet.getVehicle,
  request: http.input({ vehicleId: http.path("vehicleId") }),
});

export const PATCH = defineRoute({
  target: fleet.updateVehicle,
  request: http.input({
    vehicleId: http.path("vehicleId"),
    modelId: http.optional(http.body("modelId")),
    plate: http.optional(http.body("plate")),
    vin: http.optional(http.body("vin")),
    year: http.optional(http.body("year")),
  }),
});

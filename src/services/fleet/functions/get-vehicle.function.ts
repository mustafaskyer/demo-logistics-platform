/** Returns one vehicle of the caller's company. Other companies' vehicles are reported as not found. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { currentTenant } from "@app/platform/tenant.js";
import vehicleNotFound from "@app/services/fleet/errors/vehicle-not-found.error.js";
import { toVehicle, vehicleSchema } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.get-vehicle",
  access: { permissions: ["vehicle:read"] },
  input: z.object({ vehicleId: text().min(1) }),
  output: vehicleSchema,
  errors: [vehicleNotFound],
  handler: async ({ vehicleId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const row = await context.database.vehicle.findOne({ where: { id: vehicleId, organizationId } });
    return row === null ? vehicleNotFound.create({ vehicleId }) : toVehicle(row);
  },
});

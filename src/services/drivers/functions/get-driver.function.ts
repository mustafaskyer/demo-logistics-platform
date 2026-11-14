/** Returns one driver of the caller's company. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import driverNotFound from "@app/services/drivers/errors/driver-not-found.error.js";
import { driverSchema, toDriver } from "@app/services/drivers/schemas.js";

export default defineFunction({
  id: "drivers.get-driver",
  access: { permissions: ["driver:read"] },
  input: z.object({ driverId: z.string().min(1) }),
  output: driverSchema,
  errors: [driverNotFound],
  handler: async ({ driverId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const row = await context.database.driver.findOne({ where: { id: driverId, organizationId } });
    return row === null ? driverNotFound.create({ driverId }) : toDriver(row);
  },
});

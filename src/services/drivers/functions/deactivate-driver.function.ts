/** Deactivates a driver and releases their vehicle, if any. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { currentTenant } from "@app/platform/tenant.js";
import driverNotFound from "@app/services/drivers/errors/driver-not-found.error.js";
import { driverSchema, toDriver } from "@app/services/drivers/schemas.js";

export default defineFunction({
  id: "drivers.deactivate-driver",
  access: { permissions: ["driver:delete"] },
  input: z.object({ driverId: z.string().min(1) }),
  output: driverSchema,
  errors: [driverNotFound],
  handler: async ({ driverId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    // Both writes belong to this service, so they share one transaction.
    const result = await context.database.transaction(async (tx) => {
      const driver = await tx.driver.update({
        where: { id: driverId, organizationId },
        data: { status: "inactive", updatedAt: new Date() },
      });
      if (driver === null) return null;
      const open = (await tx.driverAssignment.findMany({ where: { organizationId, driverId } })).filter(
        (row) => row.unassignedAt === null,
      );
      for (const row of open) {
        await tx.driverAssignment.update({ where: { id: row.id }, data: { unassignedAt: new Date() } });
      }
      return driver;
    });
    return result === null ? driverNotFound.create({ driverId }) : toDriver(result);
  },
});

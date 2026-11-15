/** Reactivates an inactive driver whose license is still valid. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { currentTenant } from "@app/platform/tenant.js";
import driverNotFound from "@app/services/drivers/errors/driver-not-found.error.js";
import licenseExpired from "@app/services/drivers/errors/license-expired.error.js";
import { driverSchema, licenseValidOn, toDriver } from "@app/services/drivers/schemas.js";

export default defineFunction({
  id: "drivers.activate-driver",
  access: { permissions: ["driver:update"] },
  input: z.object({ driverId: text().min(1) }),
  output: driverSchema,
  errors: [driverNotFound, licenseExpired],
  handler: async ({ driverId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const current = await context.database.driver.findOne({ where: { id: driverId, organizationId } });
    if (current === null) return driverNotFound.create({ driverId });
    if (!licenseValidOn(current.licenseExpiresOn, context.time.now())) {
      return licenseExpired.create({ licenseExpiresOn: current.licenseExpiresOn });
    }
    const updated = await context.database.driver.update({
      where: { id: driverId, organizationId },
      data: { status: "active", updatedAt: new Date() },
    });
    return updated === null ? driverNotFound.create({ driverId }) : toDriver(updated);
  },
});

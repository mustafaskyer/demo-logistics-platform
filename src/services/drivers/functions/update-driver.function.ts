/** Updates a driver's contact details or license. Activation state has its own functions. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { constraintViolation, currentTenant, definedOnly } from "@app/platform/tenant.js";
import driverNotFound from "@app/services/drivers/errors/driver-not-found.error.js";
import licenseExpired from "@app/services/drivers/errors/license-expired.error.js";
import licenseTaken from "@app/services/drivers/errors/license-taken.error.js";
import {
  driverSchema,
  licenseClassSchema,
  licenseExpiresOnSchema,
  licenseNumberSchema,
  licenseValidOn,
  phoneSchema,
  toDriver,
} from "@app/services/drivers/schemas.js";

export default defineFunction({
  id: "drivers.update-driver",
  access: { permissions: ["driver:update"] },
  input: z.object({
    driverId: text().min(1),
    fullName: text().trim().min(2).max(120).optional(),
    phone: phoneSchema.optional(),
    licenseNumber: licenseNumberSchema.optional(),
    licenseClass: licenseClassSchema.optional(),
    licenseExpiresOn: licenseExpiresOnSchema.optional(),
  }),
  output: driverSchema,
  errors: [driverNotFound, licenseExpired, licenseTaken],
  handler: async ({ driverId, ...changes }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const current = await context.database.driver.findOne({ where: { id: driverId, organizationId } });
    if (current === null) return driverNotFound.create({ driverId });
    if (changes.licenseExpiresOn !== undefined && !licenseValidOn(changes.licenseExpiresOn, context.time.now())) {
      return licenseExpired.create({ licenseExpiresOn: changes.licenseExpiresOn });
    }
    const taken = (licenseNumber: string) => licenseTaken.create({ licenseNumber });
    if (changes.licenseNumber !== undefined && changes.licenseNumber !== current.licenseNumber) {
      const clash = await context.database.driver.findOne({ where: { organizationId, licenseNumber: changes.licenseNumber } });
      if (clash !== null) return taken(changes.licenseNumber);
    }
    try {
      const updated = await context.database.driver.update({
        where: { id: driverId, organizationId },
        data: { ...definedOnly(changes), updatedAt: new Date() },
      });
      return updated === null ? driverNotFound.create({ driverId }) : toDriver(updated);
    } catch (error) {
      if (constraintViolation(error)?.kind === "unique") return taken(changes.licenseNumber ?? current.licenseNumber);
      throw error;
    }
  },
});

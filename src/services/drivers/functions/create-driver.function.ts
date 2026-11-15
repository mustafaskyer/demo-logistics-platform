/** Registers a driver profile. The license must be valid today and unique within the company. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { constraintViolation, currentTenant } from "@app/platform/tenant.js";
import licenseExpired from "@app/services/drivers/errors/license-expired.error.js";
import licenseTaken from "@app/services/drivers/errors/license-taken.error.js";
import userAlreadyDriver from "@app/services/drivers/errors/user-already-driver.error.js";
import userNotInCompany from "@app/services/drivers/errors/user-not-in-company.error.js";
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
  id: "drivers.create-driver",
  access: { permissions: ["driver:create"] },
  input: z.object({
    fullName: text().trim().min(2).max(120),
    phone: phoneSchema,
    licenseNumber: licenseNumberSchema,
    licenseClass: licenseClassSchema,
    licenseExpiresOn: licenseExpiresOnSchema,
    userId: text().min(1).optional(),
  }),
  output: driverSchema,
  errors: [licenseExpired, licenseTaken, userNotInCompany, userAlreadyDriver],
  handler: async (input, context) => {
    const { organizationId } = await currentTenant(context.auth);
    if (!licenseValidOn(input.licenseExpiresOn, context.time.now())) {
      return licenseExpired.create({ licenseExpiresOn: input.licenseExpiresOn });
    }
    if (input.userId !== undefined) {
      // Membership is owned by Better Auth; this read only confirms the login belongs to this company.
      const membership = await context.database.member.findOne({ where: { organizationId, userId: input.userId } });
      if (membership === null) return userNotInCompany.create({ userId: input.userId });
      if ((await context.database.driver.findOne({ where: { organizationId, userId: input.userId } })) !== null) {
        return userAlreadyDriver.create({ userId: input.userId });
      }
    }
    const taken = () => licenseTaken.create({ licenseNumber: input.licenseNumber });
    if ((await context.database.driver.findOne({ where: { organizationId, licenseNumber: input.licenseNumber } })) !== null) {
      return taken();
    }
    try {
      const { userId, ...profile } = input;
      return toDriver(
        await context.database.driver.insert({
          data: { organizationId, ...profile, ...(userId === undefined ? {} : { userId }) },
        }),
      );
    } catch (error) {
      if (constraintViolation(error)?.kind === "unique") return taken();
      throw error;
    }
  },
});

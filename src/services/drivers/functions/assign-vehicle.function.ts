/** Assigns an active vehicle to an active driver. One open assignment per driver and per vehicle. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { constraintViolation, currentTenant } from "@app/platform/tenant.js";
import fleet from "@app/services/fleet/service.js";
import driverAlreadyAssigned from "@app/services/drivers/errors/driver-already-assigned.error.js";
import driverInactive from "@app/services/drivers/errors/driver-inactive.error.js";
import driverNotFound from "@app/services/drivers/errors/driver-not-found.error.js";
import licenseExpired from "@app/services/drivers/errors/license-expired.error.js";
import vehicleAlreadyAssigned from "@app/services/drivers/errors/vehicle-already-assigned.error.js";
import vehicleUnavailable from "@app/services/drivers/errors/vehicle-unavailable.error.js";
import { assignmentSchema, licenseValidOn, toAssignment } from "@app/services/drivers/schemas.js";

export default defineFunction({
  id: "drivers.assign-vehicle",
  access: { permissions: ["assignment:create"] },
  input: z.object({ driverId: text().min(1), vehicleId: text().min(1) }),
  output: assignmentSchema,
  errors: [driverNotFound, driverInactive, licenseExpired, vehicleUnavailable, driverAlreadyAssigned, vehicleAlreadyAssigned],
  dependencies: { functions: { getVehicle: fleet.getVehicle } },
  handler: async ({ driverId, vehicleId }, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const driver = await context.database.driver.findOne({ where: { id: driverId, organizationId } });
    if (driver === null) return driverNotFound.create({ driverId });
    if (driver.status !== "active") return driverInactive.create({ driverId });
    if (!licenseValidOn(driver.licenseExpiresOn, context.time.now())) {
      return licenseExpired.create({ licenseExpiresOn: driver.licenseExpiresOn });
    }
    // Fleet owns vehicle state; ask it through its public contract (it scopes to this company too).
    const vehicle = await context.functions.getVehicle({ vehicleId }).catch(() => null);
    if (vehicle === null || vehicle.status !== "active") return vehicleUnavailable.create({ vehicleId });

    const open = (await context.database.driverAssignment.findMany({ where: { organizationId } })).filter(
      (row) => row.unassignedAt === null,
    );
    if (open.some((row) => row.driverId === driverId)) return driverAlreadyAssigned.create({ driverId });
    if (open.some((row) => row.vehicleId === vehicleId)) return vehicleAlreadyAssigned.create({ vehicleId });
    try {
      return toAssignment(await context.database.driverAssignment.insert({ data: { organizationId, driverId, vehicleId } }));
    } catch (error) {
      // The partial unique indexes are the final guard against concurrent assignments.
      if (constraintViolation(error)?.kind === "unique") {
        return error instanceof Error && String(error.message).includes("driver_idx")
          ? driverAlreadyAssigned.create({ driverId })
          : vehicleAlreadyAssigned.create({ vehicleId });
      }
      throw error;
    }
  },
});

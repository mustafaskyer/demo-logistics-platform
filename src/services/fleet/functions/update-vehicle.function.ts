/** Updates a vehicle's model, plate, VIN or year. Status changes use their own functions. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { constraintViolation, currentTenant, definedOnly } from "@app/platform/tenant.js";
import modelNotFound from "@app/services/fleet/errors/model-not-found.error.js";
import plateTaken from "@app/services/fleet/errors/plate-taken.error.js";
import vehicleNotFound from "@app/services/fleet/errors/vehicle-not-found.error.js";
import vehicleRetired from "@app/services/fleet/errors/vehicle-retired.error.js";
import vinTaken from "@app/services/fleet/errors/vin-taken.error.js";
import { normalizePlate, plateSchema, toVehicle, vehicleSchema, vinSchema, yearSchema } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.update-vehicle",
  access: { permissions: ["vehicle:update"] },
  input: z.object({
    vehicleId: z.string().min(1),
    modelId: z.string().min(1).optional(),
    plate: plateSchema.optional(),
    vin: vinSchema.optional(),
    year: yearSchema.optional(),
  }),
  output: vehicleSchema,
  errors: [vehicleNotFound, vehicleRetired, modelNotFound, plateTaken, vinTaken],
  handler: async ({ vehicleId, ...input }, context) => {
    const changes = { ...input, ...(input.plate === undefined ? {} : { plate: normalizePlate(input.plate) }) };
    const { organizationId } = await currentTenant(context.auth);
    const current = await context.database.vehicle.findOne({ where: { id: vehicleId, organizationId } });
    if (current === null) return vehicleNotFound.create({ vehicleId });
    if (current.status === "retired") return vehicleRetired.create({ vehicleId });
    if (changes.modelId !== undefined) {
      const model = await context.database.vehicleModel.findOne({ where: { id: changes.modelId, organizationId } });
      if (model === null) return modelNotFound.create({ modelId: changes.modelId });
    }
    if (changes.plate !== undefined && changes.plate !== current.plate) {
      const clash = await context.database.vehicle.findOne({ where: { organizationId, plate: changes.plate } });
      if (clash !== null) return plateTaken.create({ plate: changes.plate });
    }
    if (changes.vin !== undefined && changes.vin !== current.vin) {
      const clash = await context.database.vehicle.findOne({ where: { organizationId, vin: changes.vin } });
      if (clash !== null) return vinTaken.create({ vin: changes.vin });
    }
    try {
      const updated = await context.database.vehicle.update({
        where: { id: vehicleId, organizationId },
        data: { ...definedOnly(changes), updatedAt: new Date() },
      });
      return updated === null ? vehicleNotFound.create({ vehicleId }) : toVehicle(updated);
    } catch (error) {
      const violation = constraintViolation(error);
      if (violation?.kind === "unique") {
        return violation.name.includes("vin") && changes.vin !== undefined
          ? vinTaken.create({ vin: changes.vin })
          : plateTaken.create({ plate: changes.plate ?? current.plate });
      }
      throw error;
    }
  },
});

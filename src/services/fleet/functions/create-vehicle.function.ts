/** Registers a vehicle of one of the company's models. Plate and VIN are unique per company. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { constraintViolation, currentTenant } from "@app/platform/tenant.js";
import modelNotFound from "@app/services/fleet/errors/model-not-found.error.js";
import plateTaken from "@app/services/fleet/errors/plate-taken.error.js";
import vinTaken from "@app/services/fleet/errors/vin-taken.error.js";
import { normalizePlate, plateSchema, toVehicle, vehicleSchema, vinSchema, yearSchema } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.create-vehicle",
  access: { permissions: ["vehicle:create"] },
  input: z.object({
    modelId: z.string().min(1),
    plate: plateSchema,
    vin: vinSchema.optional(),
    year: yearSchema,
  }),
  output: vehicleSchema,
  errors: [modelNotFound, plateTaken, vinTaken],
  handler: async ({ modelId, plate: rawPlate, vin, year }, context) => {
    const plate = normalizePlate(rawPlate);
    const { organizationId } = await currentTenant(context.auth);
    const model = await context.database.vehicleModel.findOne({ where: { id: modelId, organizationId } });
    if (model === null) return modelNotFound.create({ modelId });
    if ((await context.database.vehicle.findOne({ where: { organizationId, plate } })) !== null) {
      return plateTaken.create({ plate });
    }
    if (vin !== undefined && (await context.database.vehicle.findOne({ where: { organizationId, vin } })) !== null) {
      return vinTaken.create({ vin });
    }
    try {
      const row = await context.database.vehicle.insert({
        data: { organizationId, modelId, plate, year, ...(vin === undefined ? {} : { vin }) },
      });
      return toVehicle(row);
    } catch (error) {
      const violation = constraintViolation(error);
      if (violation?.kind === "unique") {
        return violation.name.includes("vin") && vin !== undefined ? vinTaken.create({ vin }) : plateTaken.create({ plate });
      }
      throw error;
    }
  },
});

/** Registers a vehicle model (make, name, body type, capacity) for the caller's company. */
import { defineFunction } from "relkit/functions";
import { z } from "zod";
import { text } from "@app/platform/text.js";
import { constraintViolation, currentTenant } from "@app/platform/tenant.js";
import modelExists from "@app/services/fleet/errors/model-exists.error.js";
import { bodyTypes, toModel, vehicleModelSchema } from "@app/services/fleet/schemas.js";

export default defineFunction({
  id: "fleet.create-model",
  access: { permissions: ["vehicleModel:create"] },
  input: z.object({
    make: text().trim().min(1).max(60),
    name: text().trim().min(1).max(60),
    bodyType: z.enum(bodyTypes),
    capacityKg: z.number().int().min(1).max(100_000),
  }),
  output: vehicleModelSchema,
  errors: [modelExists],
  handler: async (input, context) => {
    const { organizationId } = await currentTenant(context.auth);
    const duplicate = () => modelExists.create({ make: input.make, name: input.name });
    const existing = await context.database.vehicleModel.findOne({
      where: { organizationId, make: input.make, name: input.name },
    });
    if (existing !== null) return duplicate();
    try {
      return toModel(await context.database.vehicleModel.insert({ data: { organizationId, ...input } }));
    } catch (error) {
      if (constraintViolation(error)?.kind === "unique") return duplicate();
      throw error;
    }
  },
});

/** Shared fleet contracts and row mappers (plain helpers, not discovered descriptors). */
import { z } from "zod";

export const bodyTypes = ["van", "pickup", "box_truck", "flatbed", "refrigerated", "tanker", "semi_trailer", "motorcycle"] as const;
export const vehicleStatuses = ["active", "maintenance", "retired"] as const;

const currentYear = new Date().getFullYear();

export const plateSchema = z.string().trim().min(2).max(16);

/** Canonical plate form: upper case with single spaces. Applied by handlers, not by the schema. */
export const normalizePlate = (value: string): string => value.toUpperCase().replace(/\s+/g, " ");

export const vinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O or Q)");

export const yearSchema = z.number().int().min(1980).max(currentYear + 1);

export const vehicleModelSchema = z.object({
  id: z.string(),
  make: z.string(),
  name: z.string(),
  bodyType: z.enum(bodyTypes),
  capacityKg: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const vehicleSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  plate: z.string(),
  vin: z.string().nullable(),
  year: z.number().int(),
  status: z.enum(vehicleStatuses),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type VehicleModelView = z.infer<typeof vehicleModelSchema>;
export type VehicleView = z.infer<typeof vehicleSchema>;

/** Page size shared by list endpoints; query strings arrive as text so numbers are coerced. */
export const pageInput = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

interface ModelRow {
  readonly id: string;
  readonly make: string;
  readonly name: string;
  readonly bodyType: VehicleModelView["bodyType"];
  readonly capacityKg: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface VehicleRow {
  readonly id: string;
  readonly modelId: string;
  readonly plate: string;
  readonly vin: string | null;
  readonly year: number;
  readonly status: VehicleView["status"];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Maps a model row to its public shape, omitting the tenant id. */
export const toModel = (row: ModelRow): VehicleModelView => ({
  id: row.id,
  make: row.make,
  name: row.name,
  bodyType: row.bodyType,
  capacityKg: row.capacityKg,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Maps a vehicle row to its public shape, omitting the tenant id. */
export const toVehicle = (row: VehicleRow): VehicleView => ({
  id: row.id,
  modelId: row.modelId,
  plate: row.plate,
  vin: row.vin,
  year: row.year,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

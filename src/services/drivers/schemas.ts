/** Shared driver contracts and row mappers (plain helpers, not discovered descriptors). */
import { z } from "zod";
import { text } from "@app/platform/text.js";

export const driverStatuses = ["active", "inactive"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, "Not a real calendar date");

export const licenseExpiresOnSchema = isoDate;
export const phoneSchema = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number");
export const licenseNumberSchema = text().trim().toUpperCase().min(4).max(32);
export const licenseClassSchema = text().trim().toUpperCase().min(1).max(8);

export const driverSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  fullName: z.string(),
  phone: z.string(),
  licenseNumber: z.string(),
  licenseClass: z.string(),
  licenseExpiresOn: z.string(),
  status: z.enum(driverStatuses),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const assignmentSchema = z.object({
  id: z.string(),
  driverId: z.string(),
  vehicleId: z.string(),
  assignedAt: z.string(),
  unassignedAt: z.string().nullable(),
});

export type DriverView = z.infer<typeof driverSchema>;
export type AssignmentView = z.infer<typeof assignmentSchema>;

interface DriverRow {
  readonly id: string;
  readonly userId: string | null;
  readonly fullName: string;
  readonly phone: string;
  readonly licenseNumber: string;
  readonly licenseClass: string;
  readonly licenseExpiresOn: string;
  readonly status: DriverView["status"];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface AssignmentRow {
  readonly id: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly assignedAt: Date;
  readonly unassignedAt: Date | null;
}

/** Maps a driver row to its public shape, omitting the tenant id. */
export const toDriver = (row: DriverRow): DriverView => ({
  id: row.id,
  userId: row.userId,
  fullName: row.fullName,
  phone: row.phone,
  licenseNumber: row.licenseNumber,
  licenseClass: row.licenseClass,
  licenseExpiresOn: row.licenseExpiresOn,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Maps an assignment row to its public shape. */
export const toAssignment = (row: AssignmentRow): AssignmentView => ({
  id: row.id,
  driverId: row.driverId,
  vehicleId: row.vehicleId,
  assignedAt: row.assignedAt.toISOString(),
  unassignedAt: row.unassignedAt === null ? null : row.unassignedAt.toISOString(),
});

/** Whether a license that expires on `expiresOn` (inclusive) is valid on the given day. */
export const licenseValidOn = (expiresOn: string, today: Date): boolean => expiresOn >= today.toISOString().slice(0, 10);

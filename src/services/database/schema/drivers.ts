import { date, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization, user } from "./auth.js";
import { vehicle } from "./fleet.js";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const driverStatus = pgEnum("driver_status", ["active", "inactive"]);

/** A driver profile. `userId` optionally links the driver to a login in the same company. */
export const driver = pgTable(
  "driver",
  {
    id: id(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    fullName: text().notNull(),
    phone: text().notNull(),
    licenseNumber: text().notNull(),
    licenseClass: text().notNull(),
    licenseExpiresOn: date({ mode: "string" }).notNull(),
    status: driverStatus().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("driver_org_license_idx").on(table.organizationId, table.licenseNumber),
    uniqueIndex("driver_org_user_idx").on(table.organizationId, table.userId).where(sql`${table.userId} is not null`),
    index("driver_org_status_idx").on(table.organizationId, table.status),
  ],
);

/** History of which driver drives which vehicle; at most one open row per driver and per vehicle. */
export const driverAssignment = pgTable(
  "driver_assignment",
  {
    id: id(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    driverId: text()
      .notNull()
      .references(() => driver.id, { onDelete: "cascade" }),
    vehicleId: text()
      .notNull()
      .references(() => vehicle.id, { onDelete: "cascade" }),
    assignedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    unassignedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("assignment_open_driver_idx").on(table.driverId).where(sql`${table.unassignedAt} is null`),
    uniqueIndex("assignment_open_vehicle_idx").on(table.vehicleId).where(sql`${table.unassignedAt} is null`),
    index("assignment_org_idx").on(table.organizationId),
  ],
);

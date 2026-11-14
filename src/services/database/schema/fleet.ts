import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./auth.js";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const audit = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

export const vehicleBodyType = pgEnum("vehicle_body_type", [
  "van",
  "pickup",
  "box_truck",
  "flatbed",
  "refrigerated",
  "tanker",
  "semi_trailer",
  "motorcycle",
]);

export const vehicleStatus = pgEnum("vehicle_status", ["active", "maintenance", "retired"]);

/** A make/model specification shared by many vehicles of one company. */
export const vehicleModel = pgTable(
  "vehicle_model",
  {
    id: id(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    make: text().notNull(),
    name: text().notNull(),
    bodyType: vehicleBodyType().notNull(),
    capacityKg: integer().notNull(),
    ...audit,
  },
  (table) => [uniqueIndex("vehicle_model_org_make_name_idx").on(table.organizationId, table.make, table.name)],
);

/** One physical vehicle (car) owned by a company. */
export const vehicle = pgTable(
  "vehicle",
  {
    id: id(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    modelId: text()
      .notNull()
      .references(() => vehicleModel.id, { onDelete: "restrict" }),
    plate: text().notNull(),
    vin: text(),
    year: integer().notNull(),
    status: vehicleStatus().notNull().default("active"),
    ...audit,
  },
  (table) => [
    uniqueIndex("vehicle_org_plate_idx").on(table.organizationId, table.plate),
    uniqueIndex("vehicle_org_vin_idx").on(table.organizationId, table.vin).where(sql`${table.vin} is not null`),
    index("vehicle_org_status_idx").on(table.organizationId, table.status),
    index("vehicle_model_id_idx").on(table.modelId),
  ],
);

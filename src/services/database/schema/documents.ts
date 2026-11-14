import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth.js";

export const documentOwnerType = pgEnum("document_owner_type", ["driver", "vehicle"]);
export const documentStatus = pgEnum("document_status", ["pending", "uploaded"]);

/** Metadata for a file stored in the `documents.files` bucket under a company-scoped key. */
export const document = pgTable(
  "document",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerType: documentOwnerType().notNull(),
    ownerId: text().notNull(),
    kind: text().notNull(),
    objectKey: text().notNull(),
    filename: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    status: documentStatus().notNull().default("pending"),
    uploadedBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("document_object_key_idx").on(table.objectKey),
    index("document_owner_idx").on(table.organizationId, table.ownerType, table.ownerId),
  ],
);

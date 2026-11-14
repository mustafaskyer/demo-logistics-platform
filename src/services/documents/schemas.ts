/** Shared document contracts and row mapper (plain helpers, not discovered descriptors). */
import { z } from "zod";

export const ownerTypes = ["driver", "vehicle"] as const;
export const documentKinds = ["license", "registration", "insurance", "inspection", "contract", "other"] as const;
export const contentTypes = ["application/pdf", "image/jpeg", "image/png"] as const;
export const maxDocumentBytes = 5_000_000;

export const documentSchema = z.object({
  id: z.string(),
  ownerType: z.enum(ownerTypes),
  ownerId: z.string(),
  kind: z.enum(documentKinds),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(["pending", "uploaded"]),
  createdAt: z.string(),
});

export type DocumentView = z.infer<typeof documentSchema>;

interface DocumentRow {
  readonly id: string;
  readonly ownerType: DocumentView["ownerType"];
  readonly ownerId: string;
  readonly kind: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: DocumentView["status"];
  readonly createdAt: Date;
}

/** Maps a row to its public shape; the storage key and tenant id stay private. */
export const toDocument = (row: DocumentRow): DocumentView => ({
  id: row.id,
  ownerType: row.ownerType,
  ownerId: row.ownerId,
  kind: row.kind as DocumentView["kind"],
  filename: row.filename,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

/** Reduces a client filename to safe characters for use inside an object key. */
export const safeFilename = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "file";

/** Builds the company-scoped object key. The tenant id comes from the session, never the client. */
export const objectKeyFor = (organizationId: string, ownerType: string, ownerId: string, id: string, filename: string): string =>
  `${organizationId}/${ownerType}/${ownerId}/${id}-${safeFilename(filename)}`;

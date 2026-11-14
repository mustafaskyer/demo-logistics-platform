CREATE TYPE "document_status" AS ENUM('pending', 'uploaded');--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "status" "document_status" DEFAULT 'pending'::"document_status" NOT NULL;
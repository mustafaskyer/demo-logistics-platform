CREATE TYPE "document_owner_type" AS ENUM('driver', 'vehicle');--> statement-breakpoint
CREATE TYPE "driver_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "vehicle_body_type" AS ENUM('van', 'pickup', 'box_truck', 'flatbed', 'refrigerated', 'tanker', 'semi_trailer', 'motorcycle');--> statement-breakpoint
CREATE TYPE "vehicle_status" AS ENUM('active', 'maintenance', 'retired');--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"ownerType" "document_owner_type" NOT NULL,
	"ownerId" text NOT NULL,
	"kind" text NOT NULL,
	"objectKey" text NOT NULL,
	"filename" text NOT NULL,
	"contentType" text NOT NULL,
	"sizeBytes" integer NOT NULL,
	"uploadedBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"userId" text,
	"fullName" text NOT NULL,
	"phone" text NOT NULL,
	"licenseNumber" text NOT NULL,
	"licenseClass" text NOT NULL,
	"licenseExpiresOn" date NOT NULL,
	"status" "driver_status" DEFAULT 'active'::"driver_status" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_assignment" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"driverId" text NOT NULL,
	"vehicleId" text NOT NULL,
	"assignedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"unassignedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vehicle" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"modelId" text NOT NULL,
	"plate" text NOT NULL,
	"vin" text,
	"year" integer NOT NULL,
	"status" "vehicle_status" DEFAULT 'active'::"vehicle_status" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_model" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"make" text NOT NULL,
	"name" text NOT NULL,
	"bodyType" "vehicle_body_type" NOT NULL,
	"capacityKg" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_object_key_idx" ON "document" ("objectKey");--> statement-breakpoint
CREATE INDEX "document_owner_idx" ON "document" ("organizationId","ownerType","ownerId");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_org_license_idx" ON "driver" ("organizationId","licenseNumber");--> statement-breakpoint
CREATE INDEX "driver_org_status_idx" ON "driver" ("organizationId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_open_driver_idx" ON "driver_assignment" ("driverId") WHERE "unassignedAt" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_open_vehicle_idx" ON "driver_assignment" ("vehicleId") WHERE "unassignedAt" is null;--> statement-breakpoint
CREATE INDEX "assignment_org_idx" ON "driver_assignment" ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_org_plate_idx" ON "vehicle" ("organizationId","plate");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_org_vin_idx" ON "vehicle" ("organizationId","vin") WHERE "vin" is not null;--> statement-breakpoint
CREATE INDEX "vehicle_org_status_idx" ON "vehicle" ("organizationId","status");--> statement-breakpoint
CREATE INDEX "vehicle_model_id_idx" ON "vehicle" ("modelId");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_model_org_make_name_idx" ON "vehicle_model" ("organizationId","make","name");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_uploadedBy_user_id_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "driver_assignment" ADD CONSTRAINT "driver_assignment_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "driver_assignment" ADD CONSTRAINT "driver_assignment_driverId_driver_id_fkey" FOREIGN KEY ("driverId") REFERENCES "driver"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "driver_assignment" ADD CONSTRAINT "driver_assignment_vehicleId_vehicle_id_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_modelId_vehicle_model_id_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_model"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "vehicle_model" ADD CONSTRAINT "vehicle_model_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;
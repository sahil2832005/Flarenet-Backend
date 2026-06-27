-- CreateEnum
CREATE TYPE "ArchitectureStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "ProjectArchitecture" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "appType" TEXT,
    "scale" TEXT,
    "database" TEXT,
    "features" JSONB,
    "traffic" TEXT,
    "budget" TEXT,
    "resourceTier" TEXT,
    "compliance" JSONB,
    "teamSize" TEXT,
    "availability" TEXT,
    "networkIsolation" TEXT,
    "managedLevel" TEXT,
    "currentStep" TEXT,
    "status" "ArchitectureStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "recommendation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectArchitecture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectArchitecture_projectId_key" ON "ProjectArchitecture"("projectId");

-- CreateIndex
CREATE INDEX "ProjectArchitecture_status_idx" ON "ProjectArchitecture"("status");

-- AddForeignKey
ALTER TABLE "ProjectArchitecture" ADD CONSTRAINT "ProjectArchitecture_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

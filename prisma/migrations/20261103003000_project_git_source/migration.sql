-- Public GitHub source for a project created from a repository URL.
ALTER TABLE "Project" ADD COLUMN "gitOwner" TEXT;
ALTER TABLE "Project" ADD COLUMN "gitRepo" TEXT;
ALTER TABLE "Project" ADD COLUMN "gitBranch" TEXT;

SELECT migration_name, finished_at IS NOT NULL AS finished
FROM _prisma_migrations
WHERE migration_name = '20261103003000_project_git_source';

SELECT gitUrl, COUNT(*) AS copies
FROM "Project"
GROUP BY gitUrl
HAVING COUNT(*) > 1;

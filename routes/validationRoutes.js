const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../clients/prismaClient');
const { verifyToken } = require('../middlewares/authMiddleware');
const { checkArchMatch } = require('../services/validation/archMatch');

// UUID validation — same pattern used in archChatRoutes.
function isValidUUID(id) {
    if (typeof id !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * POST /api/validate
 * Enqueue a validation job for a project's repository.
 *
 * Body: { projectId: string }
 *
 * Flow:
 *   1. Verify the project belongs to the authenticated user.
 *   2. Check if the repo SHA was already validated (safelist hit).
 *   3. Create a validation_jobs row (status = pending).
 *   4. NOTIFY the Go worker via PostgreSQL so it wakes immediately.
 *   5. Return the jobId for the client to poll.
 */
router.post('/', verifyToken, async (req, res) => {
    try {
        const { projectId } = req.body;
        const userId = req.user?.userId;

        if (!isValidUUID(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        // Verify project ownership.
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true, gitUrl: true, ownerId: true }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found',
                code: 'PROJECT_NOT_FOUND'
            });
        }

        if (project.ownerId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                code: 'UNAUTHORIZED'
            });
        }

        if (!project.gitUrl) {
            return res.status(400).json({
                success: false,
                error: 'Project has no repository URL configured',
                code: 'NO_REPO_URL'
            });
        }

        // Check for an in-progress job to prevent duplicate submissions.
        const existingJob = await prisma.validationJob.findFirst({
            where: {
                repoUrl: project.gitUrl,
                status: { in: ['pending', 'running'] }
            },
            select: { id: true, status: true }
        });

        if (existingJob) {
            return res.status(409).json({
                success: false,
                error: 'A validation job is already in progress for this repository',
                code: 'JOB_IN_PROGRESS',
                data: { jobId: existingJob.id, status: existingJob.status }
            });
        }

        // Create the job row.
        const jobId = uuidv4();
        await prisma.validationJob.create({
            data: {
                id: jobId,
                repoUrl: project.gitUrl,
                status: 'pending',
                attempts: 0
            }
        });

        // Wake the Go worker immediately via NOTIFY.
        // The worker is sleeping on LISTEN validation_jobs_new.
        await prisma.$executeRaw`NOTIFY validation_jobs_new`;

        return res.status(202).json({
            success: true,
            data: {
                jobId,
                status: 'pending',
                message: 'Validation job queued'
            }
        });
    } catch (error) {
        console.error('[Validation] Enqueue error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to enqueue validation job'
        });
    }
});

/**
 * GET /api/validate/jobs/:jobId
 * Poll the status of a validation job.
 *
 * Returns:
 *   - status: pending | running | completed | failed
 *   - result: manifest summary (when completed)
 *   - error: reason (when failed)
 *   - archMatch: cross-check against project's arch answers (when completed)
 */
router.get('/jobs/:jobId', verifyToken, async (req, res) => {
    try {
        const { jobId } = req.params;

        if (!isValidUUID(jobId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid jobId is required',
                code: 'INVALID_JOB_ID'
            });
        }

        const job = await prisma.validationJob.findUnique({
            where: { id: jobId },
            select: {
                id: true,
                repoUrl: true,
                status: true,
                result: true,
                error: true,
                createdAt: true,
                startedAt: true,
                finishedAt: true,
                attempts: true
            }
        });

        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found',
                code: 'JOB_NOT_FOUND'
            });
        }

        const response = {
            jobId: job.id,
            status: job.status,
            repoUrl: job.repoUrl,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            attempts: job.attempts
        };

        if (job.status === 'failed') {
            response.error = job.error;
        }

        if (job.status === 'completed' && job.result) {
            response.result = job.result;

            // Cross-check manifest against the project's arch recommendation.
            try {
                const project = await prisma.project.findFirst({
                    where: { gitUrl: job.repoUrl },
                    select: {
                        id: true,
                        architecture: {
                            select: {
                                appType: true,
                                scale: true,
                                database: true,
                                features: true,
                                traffic: true,
                                budget: true,
                                recommendation: true
                            }
                        }
                    }
                });

                if (project?.architecture) {
                    response.archMatch = checkArchMatch(job.result, project.architecture);
                }
            } catch (matchErr) {
                // Non-fatal — job result still returns without arch match
                console.error('[Validation] archMatch error:', matchErr.message);
            }
        }

        return res.json({ success: true, data: response });
    } catch (error) {
        console.error('[Validation] Poll error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch job status'
        });
    }
});

module.exports = router;

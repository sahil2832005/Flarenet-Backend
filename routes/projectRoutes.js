const express = require('express');
const { z, ZodError } = require('zod');
const { prisma } = require('../clients/prismaClient');
const { verifyToken } = require('../middlewares/authMiddleware');
const { parsePublicGitHubRepo } = require('../services/github/publicRepoUrl');

const router = express.Router();

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createProjectSchema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    gitUrl: z.string().trim().min(1).optional(),
    repoUrl: z.string().trim().min(1).optional(),
    description: z.string().trim().max(280).optional(),
});

const ownerSelect = {
    select: {
        id: true,
        email: true,
        name: true,
        role: true,
    },
};

function requireUserId(req, res) {
    const userId = req.user?.userId;
    if (userId === undefined || userId === null || userId === '') {
        res.status(401).json({
            success: false,
            message: 'Access denied. No token provided.',
        });
        return null;
    }
    return Number(userId);
}

function sendHandlerError(res, error, message) {
    if (error instanceof ZodError) {
        return res.status(400).json({
            success: false,
            message: error.issues[0]?.message || 'Invalid project',
        });
    }
    return res.status(500).json({
        success: false,
        message,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
}

router.post('/create-project', verifyToken, async function (req, res) {
    const userId = requireUserId(req, res);
    if (userId === null) return;

    try {
        const isValidated = createProjectSchema.parse(req.body);
        const source = parsePublicGitHubRepo(isValidated.repoUrl || isValidated.gitUrl || '');
        if (!source.ok) {
            return res.status(400).json({
                success: false,
                message: source.message,
            });
        }

        const newProject = await prisma.project.create({
            data: {
                name: isValidated.name || source.repo,
                gitUrl: source.gitUrl,
                description: isValidated.description || null,
                gitOwner: source.owner,
                gitRepo: source.repo,
                gitBranch: source.branch,
                owner: {
                    connect: { id: userId },
                },
            },
            include: { owner: ownerSelect },
        });

        res.status(200).json({
            success: true,
            message: 'Project created successfully!',
            project: newProject,
        });
    } catch (e) {
        if (e?.code === 'P2002') {
            return res.status(409).json({
                success: false,
                message: 'A project for that repository already exists',
            });
        }
        return sendHandlerError(res, e, 'Problem creating project');
    }
});

router.get('/projects/detail/:projectId', verifyToken, async function (req, res) {
    const userId = requireUserId(req, res);
    if (userId === null) return;

    const { projectId } = req.params;
    if (!PROJECT_ID.test(projectId)) {
        return res.status(400).json({
            success: false,
            message: 'Valid projectId is required',
        });
    }

    try {
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { owner: ownerSelect },
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found',
            });
        }

        if (project.ownerId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You do not own this project',
            });
        }

        res.status(200).json({ success: true, data: project });
    } catch (e) {
        return sendHandlerError(res, e, 'Error fetching project');
    }
});

router.get('/projects/:ownerId', verifyToken, async function (req, res) {
    const userId = requireUserId(req, res);
    if (userId === null) return;

    const ownerId = parseInt(req.params.ownerId, 10);
    if (Number.isNaN(ownerId)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid ownerId',
        });
    }

    if (ownerId !== userId) {
        return res.status(403).json({
            success: false,
            message: 'You do not own this project',
        });
    }

    try {
        const projects = await prisma.project.findMany({
            where: { ownerId: userId },
            include: {
                deployments: true,
                owner: ownerSelect,
            },
        });

        res.status(200).json({
            success: true,
            data: projects,
        });
    } catch (e) {
        return sendHandlerError(res, e, 'Error fetching projects');
    }
});

router.get('/api/project/:id', verifyToken, async (req, res) => {
    const userId = requireUserId(req, res);
    if (userId === null) return;

    const { id } = req.params;
    if (!PROJECT_ID.test(id)) {
        return res.status(400).json({
            success: false,
            message: 'Valid projectId is required',
        });
    }

    try {
        const project = await prisma.project.findUnique({
            where: { id },
            include: { owner: ownerSelect },
        });
        if (!project) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }
        if (project.ownerId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You do not own this project',
            });
        }
        res.json({ success: true, data: project });
    } catch (error) {
        return sendHandlerError(res, error, 'Failed to fetch project');
    }
});

module.exports = router;

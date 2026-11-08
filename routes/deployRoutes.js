const express = require('express');
const { z } = require('zod');
const { prisma } = require('../clients/prismaClient');
const buildQueue = require('../queues/buildQueue');

const router = express.Router();

const deploymentSchema = z.object({
    projectId: z.string().uuid('Invalid project ID'),
    environment: z.enum(['DEV', 'STAGING', 'PROD'], { message: 'Invalid environment' }).default('STAGING'),
    status: z.enum(['INACTIVE', 'ACTIVE', 'FAILED']).optional().default('INACTIVE'),
    version: z.string().optional(),
    autoDeploy: z.boolean().optional().default(false),
    buildCommand: z.string().min(1, 'Build command is required').optional().or(z.literal('')),
    envVariables: z.array(z.object({
        key: z.string().min(1, 'Key is required'),
        value: z.string().min(1, 'Value is required'),
    })).optional().default([]),
});

router.post('/deploy', async (req, res) => {
    try {
        if (req.body.envVariables) {
            req.body.envVariables = req.body.envVariables.filter(env => env.key.trim() !== '' && env.value.trim() !== '');
        }

        const validatedData = deploymentSchema.parse(req.body);
        const generatedUri = validatedData.url || `https://${validatedData.projectId}.localhost:9000`;

        const project = await prisma.project.findUnique({
            where: { id: validatedData.projectId },
        });

        if (!project) {
            return res.status(404).send({
                success: false,
                message: 'Project not found',
            });
        }

        const newDeployment = await prisma.deployment.create({
            data: {
                projectId: validatedData.projectId,
                environment: validatedData.environment,
                status: validatedData.status,
                url: generatedUri,
                version: validatedData.version || 'v1.0.0',
                autoDeploy: validatedData.autoDeploy,
            },
            include: {
                project: true,
            },
        });

        await buildQueue.add('deploy', {
            deploymentId: newDeployment.id,
            projectId: newDeployment.project.id,
            environment: validatedData.environment,
            gitUrl: newDeployment.project.gitUrl,
            version: validatedData.version || 'v1.0.0',
            buildCommand: validatedData.buildCommand && validatedData.buildCommand.trim() !== ''
                ? validatedData.buildCommand
                : 'npm install && npm run build',
            envVars: validatedData.envVariables?.length ? validatedData.envVariables : [],
        });

        return res.json({ status: 'queued', data: { deploymentId: newDeployment.id, domain: newDeployment.url } });
    } catch (e) {
        return res.status(500).send({
            success: false,
            message: 'Internal service error for deployment',
            error: process.env.NODE_ENV === 'development' ? e.message : undefined,
        });
    }
});

module.exports = router;

/**
 * Session Store for Architecture Chat
 * Uses PostgreSQL via Prisma - linked to Project
 */

const { prisma } = require('../../clients/prismaClient');

/**
 * Load a project and require the caller to own it.
 * Returns { project } or { error, code }.
 */
async function requireProjectOwner(projectId, userId) {
    if (userId === null || userId === undefined || userId === '') {
        return {
            error: 'You do not own this project',
            code: 'UNAUTHORIZED'
        };
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId }
    });

    if (!project) {
        return {
            error: 'Project not found',
            code: 'PROJECT_NOT_FOUND'
        };
    }

    if (project.ownerId !== Number(userId)) {
        return {
            error: 'You do not own this project',
            code: 'UNAUTHORIZED'
        };
    }

    return { project };
}

/**
 * Create or reset architecture session for a project
 * Called when user starts the questionnaire
 */
async function createSession(projectId, userId = null) {
    const access = await requireProjectOwner(projectId, userId);
    if (access.error) {
        const error = new Error(access.error);
        error.code = access.code;
        throw error;
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { architecture: true }
    });

    // If architecture record exists, reset it for re-run
    if (project.architecture) {
        const reset = await prisma.projectArchitecture.update({
            where: { projectId },
            data: {
                // Original fields
                appType: null,
                scale: null,
                database: null,
                features: null,
                traffic: null,
                budget: null,
                resourceTier: null,
                teamSize: null,
                availability: null,
                managedLevel: null,
                // Reset state
                currentStep: 'app_type',
                status: 'IN_PROGRESS',
                recommendation: null,
                completedAt: null
            }
        });
        return mapToSession(reset);
    }

    // Create new architecture record
    const architecture = await prisma.projectArchitecture.create({
        data: {
            projectId,
            currentStep: 'app_type',
            status: 'IN_PROGRESS'
        }
    });

    return mapToSession(architecture);
}

/**
 * Get session by project ID
 * Returns null if no architecture record exists
 */
async function getSession(projectId) {
    const architecture = await prisma.projectArchitecture.findUnique({
        where: { projectId }
    });

    if (!architecture) return null;
    return mapToSession(architecture);
}

/**
 * Update session with new answer or state change
 */
async function updateSession(projectId, updates) {
    const { currentStep, answers, completed, result, reset } = updates;

    // Build update object
    const updateData = {};

    // Update current step if provided
    if (currentStep !== undefined) {
        updateData.currentStep = currentStep;
    }

    // Handle reset - clear all answers
    if (reset) {
        // Original fields
        updateData.appType = null;
        updateData.scale = null;
        updateData.database = null;
        updateData.features = null;
        updateData.traffic = null;
        updateData.budget = null;
        updateData.resourceTier = null;
        updateData.teamSize = null;
        updateData.availability = null;
        updateData.managedLevel = null;
        // Reset state
        updateData.status = 'IN_PROGRESS';
        updateData.recommendation = null;
        updateData.completedAt = null;
    }
    // Map answers to individual columns
    else if (answers) {
        // Original fields
        if (answers.app_type !== undefined) updateData.appType = answers.app_type;
        if (answers.scale !== undefined) updateData.scale = answers.scale;
        if (answers.database !== undefined) updateData.database = answers.database;
        if (answers.features !== undefined) updateData.features = answers.features;
        if (answers.traffic !== undefined) updateData.traffic = answers.traffic;
        if (answers.budget !== undefined) updateData.budget = answers.budget;
        if (answers.resource_tier !== undefined) updateData.resourceTier = answers.resource_tier;
        if (answers.team_size !== undefined) updateData.teamSize = answers.team_size;
        if (answers.availability !== undefined) updateData.availability = answers.availability;
        if (answers.managed_level !== undefined) updateData.managedLevel = answers.managed_level;
    }

    // Mark as completed if flow finished
    if (completed) {
        updateData.status = 'COMPLETED';
        updateData.completedAt = new Date();
        updateData.currentStep = null;
        if (result) {
            updateData.recommendation = result;
        }
    }

    const updated = await prisma.projectArchitecture.update({
        where: { projectId },
        data: updateData
    });

    return mapToSession(updated);
}

/**
 * Delete architecture record for a project
 */
async function deleteSession(projectId) {
    await prisma.projectArchitecture.delete({
        where: { projectId }
    }).catch(() => null); // Ignore if not found
}

/**
 * Get stats for debugging
 */
async function getStats() {
    const [total, inProgress, completed] = await Promise.all([
        prisma.projectArchitecture.count(),
        prisma.projectArchitecture.count({ where: { status: 'IN_PROGRESS' } }),
        prisma.projectArchitecture.count({ where: { status: 'COMPLETED' } })
    ]);

    return {
        storage: 'PostgreSQL',
        total,
        inProgress,
        completed
    };
}

/**
 * Map database record to session format
 * This keeps compatibility with existing service layer
 */
function mapToSession(arch) {
    // Build answers object from individual columns
    const answers = {};
    // Original fields
    if (arch.appType) answers.app_type = arch.appType;
    if (arch.scale) answers.scale = arch.scale;
    if (arch.database) answers.database = arch.database;
    if (arch.features) answers.features = arch.features;
    if (arch.traffic) answers.traffic = arch.traffic;
    if (arch.budget) answers.budget = arch.budget;
    if (arch.resourceTier) answers.resource_tier = arch.resourceTier;
    if (arch.teamSize) answers.team_size = arch.teamSize;
    if (arch.availability) answers.availability = arch.availability;
    if (arch.managedLevel) answers.managed_level = arch.managedLevel;

    return {
        id: arch.projectId,           // Use projectId as session ID
        projectId: arch.projectId,
        userId: null,                  // Not stored in this table
        currentStep: arch.currentStep || 'app_type',
        answers,
        completed: arch.status === 'COMPLETED',
        result: arch.recommendation,
        createdAt: arch.createdAt.toISOString(),
        updatedAt: arch.updatedAt.toISOString()
    };
}

module.exports = {
    requireProjectOwner,
    createSession,
    getSession,
    updateSession,
    deleteSession,
    getStats
};


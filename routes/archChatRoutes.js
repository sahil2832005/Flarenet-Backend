/**
 * Architecture Chat API Routes
 * Guided conversation for architecture recommendations
 */

const express = require('express');
const router = express.Router();
const archChat = require('../services/archChat');
const createRateLimiter = require('../middlewares/tokenBucketLimiter');
const { verifyToken } = require('../middlewares/authMiddleware');

// Rate limiter for chat endpoints (more lenient than auth)
const chatRateLimiter = createRateLimiter({
    tokensPerInterval: 30,     // 30 requests
    interval: 60 * 1000,       // per minute
    maxBurst: 10               // burst allowance
});

// Stricter limiter for session creation (prevent DoS)
const startRateLimiter = createRateLimiter({
    tokensPerInterval: 10,     // 10 new sessions
    interval: 60 * 1000,       // per minute
    maxBurst: 5
});

/**
 * Sanitize string input to prevent XSS
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/[<>]/g, '')           // Remove < and >
        .replace(/javascript:/gi, '')    // Remove javascript: protocol
        .replace(/on\w+=/gi, '')         // Remove event handlers
        .substring(0, 500);              // Limit length
}

/**
 * Validate projectId format (UUID)
 */
function isValidProjectId(projectId) {
    if (!projectId || typeof projectId !== 'string') return false;
    // UUID v4 format
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
}

/**
 * POST /arch-chat/start
 * Start a new architecture chat session for a project
 * 
 * Request: { projectId: string } (required, UUID format)
 * Response: { projectId, step, question, options, progress }
 */
router.post('/start', verifyToken, startRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.body;
        const userId = req.user?.id || req.user?.userId || null;

        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        const result = await archChat.startChat(projectId, userId);
        
        if (result.error) {
            const statusCode = result.code === 'MISSING_PROJECT_ID' ? 400 : 500;
            return res.status(statusCode).json({
                success: false,
                error: result.error,
                code: result.code
            });
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('[ArchChat] Start error:', error);
        
        // Handle specific Prisma errors
        if (error.message === 'Project not found') {
            return res.status(404).json({
                success: false,
                error: 'Project not found',
                code: 'PROJECT_NOT_FOUND'
            });
        }
        if (error.message?.includes('Unauthorized')) {
            return res.status(403).json({
                success: false,
                error: 'You do not own this project',
                code: 'UNAUTHORIZED'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to start chat session'
        });
    }
});

/**
 * POST /arch-chat/answer
 * Submit answer to current question
 * 
 * Request: { projectId: string, answer: string | string[] }
 * Response: { nextQuestion... } or { completed: true, result: ... }
 * Error 422: Configuration blocked - user must change answers
 */
router.post('/answer', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId, answer } = req.body;

        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        if (answer === undefined || answer === null) {
            return res.status(400).json({
                success: false,
                error: 'answer is required'
            });
        }

        const result = await archChat.answerQuestion(projectId, answer);

        // Handle blocked configuration (user must fix their answers)
        if (result.blocked) {
            return res.status(422).json({
                success: false,
                blocked: true,
                error: result.error,
                code: result.code || 'CONFIGURATION_BLOCKED',
                data: {
                    blockedField: result.blockedField,
                    blockedValue: result.blockedValue,
                    details: result.details,
                    recommendation: result.recommendation,
                    userMessage: result.userMessage,
                    goBackTo: result.goBackTo,
                    currentAnswers: result.currentAnswers
                }
            });
        }

        if (result.error) {
            const statusCode = result.code === 'SESSION_NOT_FOUND' ? 404 : 400;
            return res.status(statusCode).json({
                success: false,
                error: result.error,
                code: result.code
            });
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('[ArchChat] Answer error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process answer'
        });
    }
});

/**
 * GET /arch-chat/project/:projectId
 * Get current session state for a project
 * 
 * Response: Current step or completed result
 */
router.get('/project/:projectId', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.params;
        
        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }
        
        const result = await archChat.getSessionState(projectId);

        if (result.error) {
            return res.status(404).json({
                success: false,
                error: result.error,
                code: result.code
            });
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('[ArchChat] Get session error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get session'
        });
    }
});

/**
 * POST /arch-chat/validate
 * Pre-validate an answer BEFORE committing (real-time validation)
 * Use this to warn user if their selection would block configuration
 * 
 * Request: { projectId: string, questionId: string, answer: string|array }
 * Response: { wouldBlock: boolean, error?: string, recommendation?: object }
 */
router.post('/validate', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId, questionId, answer } = req.body;

        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        if (!questionId || typeof questionId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Valid questionId is required',
                code: 'INVALID_QUESTION_ID'
            });
        }

        const result = await archChat.preValidateAnswer(projectId, questionId, answer);

        if (result.error && result.code === 'SESSION_NOT_FOUND') {
            return res.status(404).json({
                success: false,
                error: result.error,
                code: result.code
            });
        }

        // Return validation result (not an error even if wouldBlock is true)
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('[ArchChat] Pre-validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate answer'
        });
    }
});

/**
 * POST /arch-chat/back
 * Go back to previous question
 * 
 * Request: { projectId: string }
 * Response: Previous step data
 */
router.post('/back', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.body;

        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        const result = await archChat.goBack(projectId);

        if (result.error) {
            const statusCode = result.code === 'SESSION_NOT_FOUND' ? 404 : 400;
            return res.status(statusCode).json({
                success: false,
                error: result.error,
                code: result.code
            });
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('[ArchChat] Go back error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to go back'
        });
    }
});

/**
 * POST /arch-chat/reset
 * Reset session to start over
 * 
 * Request: { projectId: string }
 * Response: First step data
 */
router.post('/reset', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.body;

        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        const result = await archChat.resetSession(projectId);

        if (result.error) {
            return res.status(404).json({
                success: false,
                error: result.error,
                code: result.code
            });
        }

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('[ArchChat] Reset error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset session'
        });
    }
});

/**
 * GET /arch-chat/stats
 * Get service statistics (DEVELOPMENT ONLY, requires auth)
 * 
 * Response: { usingRedis, memorySessionCount }
 */
router.get('/stats', verifyToken, async (req, res) => {
    // Only allow in development mode
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({
            success: false,
            error: 'Not found'
        });
    }
    
    try {
        const stats = await archChat.getStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('[ArchChat] Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get stats'
        });
    }
});

/**
 * GET /arch-chat/flow
 * Get the entire flow definition (for debugging/preview)
 * DEVELOPMENT ONLY
 * 
 * Response: All steps with questions and options
 */
router.get('/flow', verifyToken, (req, res) => {
    // Only allow in development mode
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({
            success: false,
            error: 'Not found'
        });
    }
    
    res.json({
        success: true,
        data: {
            totalSteps: archChat.chatFlow.FLOW_STEPS.length,
            steps: archChat.chatFlow.FLOW_STEPS.map((step, index) => ({
                order: index + 1,
                id: step.id,
                question: step.question,
                optionCount: step.options.length,
                multiSelect: step.multiSelect || false
            }))
        }
    });
});

module.exports = router;

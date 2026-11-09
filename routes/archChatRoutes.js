const express = require('express');
const router = express.Router();
const archChat = require('../services/archChat');
const createRateLimiter = require('../middlewares/tokenBucketLimiter');
const { verifyToken } = require('../middlewares/authMiddleware');

function archChatLimitKey(prefix) {
    return (req) => {
        const userId = req.user?.userId;
        if (userId !== undefined && userId !== null && userId !== '') {
            return `${prefix}:${userId}`;
        }
        const ip = req.ip && req.ip.startsWith('::ffff:') ? req.ip.substring(7) : req.ip;
        return `${prefix}:${ip || 'unknown'}`;
    };
}

const chatRateLimiter = createRateLimiter({
    defaultBucketSize: 10,
    defaultRefillRate: 0.5,
    keyGenerator: archChatLimitKey('arch-chat'),
    failOpen: true
});

const startRateLimiter = createRateLimiter({
    defaultBucketSize: 5,
    defaultRefillRate: 10 / 60,
    keyGenerator: archChatLimitKey('arch-chat-start'),
    failOpen: true
});

function isValidProjectId(projectId) {
    if (typeof projectId !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
}

function requireUserId(req, res) {
    const userId = req.user?.userId;
    if (userId === null || userId === undefined || userId === '') {
        res.status(401).json({
            success: false,
            message: 'Access denied. No token provided.',
            code: 'UNAUTHORIZED'
        });
        return null;
    }
    return userId;
}

function sendOwnerError(res, result) {
    if (result.code === 'PROJECT_NOT_FOUND') {
        res.status(404).json({
            success: false,
            error: result.error,
            code: result.code
        });
        return true;
    }
    if (result.code === 'UNAUTHORIZED') {
        res.status(403).json({
            success: false,
            error: result.error,
            code: result.code
        });
        return true;
    }
    return false;
}

router.post('/start', verifyToken, startRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.body;
        const userId = requireUserId(req, res);
        if (userId === null) return;

        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        const result = await archChat.startChat(projectId, userId);
        
        if (result.error) {
            if (sendOwnerError(res, result)) return;
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
        res.status(500).json({
            success: false,
            error: 'Failed to start chat session'
        });
    }
});

router.post('/answer', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId, answer } = req.body;
        const userId = requireUserId(req, res);
        if (userId === null) return;

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

        const result = await archChat.answerQuestion(projectId, answer, userId);

        if (sendOwnerError(res, result)) return;

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

        if (result.code === 'OPTION_NOT_AVAILABLE' || result.code === 'FOCUS_MODE_VIOLATION') {
            return res.status(422).json({
                success: false,
                error: result.error,
                code: result.code,
                data: {
                    step: result.step || result.goBackTo,
                    value: result.value,
                    status: result.status,
                    violations: result.violations,
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

router.get('/project/:projectId', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = requireUserId(req, res);
        if (userId === null) return;
        
        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }
        
        const result = await archChat.getSessionState(projectId, userId);

        if (sendOwnerError(res, result)) return;

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

router.post('/validate', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId, questionId, answer } = req.body;
        const userId = requireUserId(req, res);
        if (userId === null) return;

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

        const result = await archChat.preValidateAnswer(projectId, questionId, answer, userId);

        if (sendOwnerError(res, result)) return;

        if (result.error && result.code === 'SESSION_NOT_FOUND') {
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
        console.error('[ArchChat] Pre-validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate answer'
        });
    }
});

router.post('/back', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.body;
        const userId = requireUserId(req, res);
        if (userId === null) return;

        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        const result = await archChat.goBack(projectId, userId);

        if (sendOwnerError(res, result)) return;

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

router.post('/reset', verifyToken, chatRateLimiter, async (req, res) => {
    try {
        const { projectId } = req.body;
        const userId = requireUserId(req, res);
        if (userId === null) return;

        if (!isValidProjectId(projectId)) {
            return res.status(400).json({
                success: false,
                error: 'Valid projectId is required',
                code: 'INVALID_PROJECT_ID'
            });
        }

        const result = await archChat.resetSession(projectId, userId);

        if (sendOwnerError(res, result)) return;

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
module.exports.isValidProjectId = isValidProjectId;

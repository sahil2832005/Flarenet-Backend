/**
 * Architecture Chat Service
 * Main entry point - exports all public functions
 */

const chatFlow = require('./chatFlow');
const sessionStore = require('./sessionStore');
const ruleEngine = require('./ruleEngine');
const responseFormatter = require('./responseFormatter');

/**
 * Start a new chat session for a project
 * @param {string} projectId - Required project ID (UUID) to link architecture
 * @param {number} userId - Optional user ID for ownership validation
 */
async function startChat(projectId, userId = null) {
    if (!projectId) {
        return { error: 'Project ID is required', code: 'MISSING_PROJECT_ID' };
    }

    const session = await sessionStore.createSession(projectId, userId);
    const firstStep = chatFlow.getFirstStep();

    return {
        projectId: session.projectId,
        step: firstStep.id,
        question: firstStep.question,
        options: firstStep.options,
        multiSelect: firstStep.multiSelect || false,
        progress: {
            current: 1,
            total: chatFlow.FLOW_STEPS.length
        }
    };
}

/**
 * Process user's answer and return next question or result
 * @param {string} projectId - Project ID (UUID)
 * @param {string|array} answer - User's answer
 */
async function answerQuestion(projectId, answer) {
    // Get session by project ID
    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No architecture session found for this project', code: 'SESSION_NOT_FOUND' };
    }

    if (session.completed) {
        return { error: 'Session already completed', code: 'SESSION_COMPLETED' };
    }

    // Validate answer
    const validation = chatFlow.validateAnswer(session.currentStep, answer);
    if (!validation.valid) {
        return { error: validation.error, code: 'INVALID_ANSWER' };
    }

    // Save answer
    const updatedAnswers = {
        ...session.answers,
        [session.currentStep]: answer
    };

    // Check if this was the last step
    if (chatFlow.isLastStep(session.currentStep)) {
        // Generate architecture
        const architecture = ruleEngine.generateArchitecture(updatedAnswers);
        
        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 2.1: Check if configuration was BLOCKED
        // If blocked, we DON'T complete the session - user must fix their answers
        // ═══════════════════════════════════════════════════════════════════════
        if (architecture.blocked) {
            return {
                blocked: true,
                error: architecture.error,
                blockedField: architecture.blockedField,
                blockedValue: architecture.blockedValue,
                details: architecture.details,
                recommendation: architecture.recommendation,
                userMessage: architecture.userMessage,
                // Tell frontend which question to go back to
                goBackTo: getQuestionIdForField(architecture.blockedField),
                // Return current answers so user can modify
                currentAnswers: updatedAnswers,
                code: 'CONFIGURATION_BLOCKED'
            };
        }
        // ═══════════════════════════════════════════════════════════════════════
        
        const formattedResult = responseFormatter.formatFullResponse(architecture);
        const chatSummary = responseFormatter.formatChatResponse(architecture);

        // Mark session complete
        await sessionStore.updateSession(projectId, {
            answers: updatedAnswers,
            completed: true,
            result: architecture
        });

        return {
            completed: true,
            result: formattedResult,
            chatMessage: chatSummary,
            projectId
        };
    }

    // Get next step
    const nextStep = chatFlow.getNextStep(session.currentStep);
    
    // Update session
    await sessionStore.updateSession(projectId, {
        currentStep: nextStep.id,
        answers: updatedAnswers
    });

    const currentIndex = chatFlow.FLOW_STEPS.findIndex(s => s.id === nextStep.id);

    return {
        completed: false,
        step: nextStep.id,
        question: nextStep.question,
        options: nextStep.options,
        multiSelect: nextStep.multiSelect || false,
        progress: {
            current: currentIndex + 1,
            total: chatFlow.FLOW_STEPS.length
        },
        previousAnswers: updatedAnswers
    };
}

/**
 * Get current session state for a project
 * @param {string} projectId - Project ID (UUID)
 */
async function getSessionState(projectId) {
    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No architecture session found for this project', code: 'SESSION_NOT_FOUND' };
    }

    if (session.completed) {
        return {
            completed: true,
            projectId,
            result: responseFormatter.formatFullResponse(session.result),
            answers: session.answers
        };
    }

    const currentStep = chatFlow.getStep(session.currentStep);
    const currentIndex = chatFlow.FLOW_STEPS.findIndex(s => s.id === session.currentStep);

    return {
        completed: false,
        projectId,
        step: currentStep.id,
        question: currentStep.question,
        options: currentStep.options,
        multiSelect: currentStep.multiSelect || false,
        progress: {
            current: currentIndex + 1,
            total: chatFlow.FLOW_STEPS.length
        },
        previousAnswers: session.answers
    };
}

/**
 * Go back to previous question
 * @param {string} projectId - Project ID (UUID)
 */
async function goBack(projectId) {
    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No architecture session found for this project', code: 'SESSION_NOT_FOUND' };
    }

    const stepIds = chatFlow.getAllStepIds();
    const currentIndex = stepIds.indexOf(session.currentStep);

    if (currentIndex <= 0) {
        return { error: 'Already at first question', code: 'AT_START' };
    }

    const previousStepId = stepIds[currentIndex - 1];
    const previousStep = chatFlow.getStep(previousStepId);

    // Remove current step answer and go back
    const updatedAnswers = { ...session.answers };
    delete updatedAnswers[session.currentStep];

    await sessionStore.updateSession(projectId, {
        currentStep: previousStepId,
        answers: updatedAnswers
    });

    return {
        step: previousStep.id,
        question: previousStep.question,
        options: previousStep.options,
        multiSelect: previousStep.multiSelect || false,
        progress: {
            current: currentIndex, // Already 0-indexed, going back
            total: chatFlow.FLOW_STEPS.length
        },
        previousAnswers: updatedAnswers
    };
}

/**
 * Reset session to start over
 * @param {string} projectId - Project ID (UUID)
 */
async function resetSession(projectId) {
    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No architecture session found for this project', code: 'SESSION_NOT_FOUND' };
    }

    const firstStep = chatFlow.getFirstStep();

    await sessionStore.updateSession(projectId, {
        currentStep: firstStep.id,
        reset: true  // Clear all answer columns
    });

    return {
        projectId,
        step: firstStep.id,
        question: firstStep.question,
        options: firstStep.options,
        multiSelect: firstStep.multiSelect || false,
        progress: {
            current: 1,
            total: chatFlow.FLOW_STEPS.length
        }
    };
}

/**
 * Initialize service (call on app startup)
 */
async function initialize() {
    console.log('[ArchChat] Service initialized (PostgreSQL storage)');
}

/**
 * Get service stats
 */
async function getStats() {
    return await sessionStore.getStats();
}

/**
 * Map blocked field names to question IDs for navigation
 */
function getQuestionIdForField(fieldName) {
    const fieldToQuestion = {
        'app_type': 'app_type',
        'resource_tier': 'resource_tier',
        'features': 'features',
        'compliance': 'compliance',
        'availability': 'availability',
        'network_isolation': 'network_isolation',
        'traffic': 'traffic',
        'database': 'database',
        'scale': 'scale',
        'team_size': 'team_size',
        'managed_level': 'managed_level',
        'budget': 'budget'
    };
    return fieldToQuestion[fieldName] || fieldName;
}

/**
 * Validate answer BEFORE committing (real-time validation)
 * Returns validation result without saving
 */
async function preValidateAnswer(projectId, questionId, proposedAnswer) {
    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No session found', code: 'SESSION_NOT_FOUND' };
    }
    
    // Build temporary config with proposed answer
    const tempAnswers = {
        ...session.answers,
        [questionId]: proposedAnswer
    };
    
    // Check if this would cause a block
    const { validateProposedAnswer } = ruleEngine;
    const validationResult = validateProposedAnswer(session.answers, questionId, proposedAnswer);
    
    if (!validationResult.valid) {
        return {
            wouldBlock: true,
            error: validationResult.error,
            blockedField: validationResult.blockedField,
            recommendation: validationResult.recommendation,
            userMessage: validationResult.userMessage || formatBlockedWarning(validationResult)
        };
    }
    
    return { wouldBlock: false, valid: true };
}

/**
 * Format a pre-validation warning for the user
 */
function formatBlockedWarning(validation) {
    let msg = `⚠️ This selection would block your configuration:\n\n`;
    msg += `${validation.error}\n\n`;
    if (validation.recommendation) {
        msg += `Consider:\n`;
        Object.values(validation.recommendation).forEach((opt, i) => {
            msg += `${i + 1}. ${opt.action}\n`;
        });
    }
    return msg;
}

module.exports = {
    initialize,
    startChat,
    answerQuestion,
    getSessionState,
    goBack,
    resetSession,
    getStats,
    preValidateAnswer,  // New: Real-time validation
    
    // Expose sub-modules for direct access if needed
    chatFlow,
    ruleEngine,
    responseFormatter
};

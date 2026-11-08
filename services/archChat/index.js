const chatFlow = require('./chatFlow');
const sessionStore = require('./sessionStore');
const ruleEngine = require('./ruleEngine');
const responseFormatter = require('./responseFormatter');
const archFocusMode = require('./archFocusMode');

async function ensureValidCurrentStep(projectId, session) {
    const normalizedStep = chatFlow.normalizeCurrentStep(session.currentStep);
    if (normalizedStep !== session.currentStep) {
        await sessionStore.updateSession(projectId, { currentStep: normalizedStep });
        session.currentStep = normalizedStep;
    }
    return session;
}

function buildStepResponse(session, stepDef) {
    const currentIndex = chatFlow.FLOW_STEPS.findIndex(s => s.id === stepDef.id);
    return archFocusMode.enrichStepPayload(stepDef, session.answers || {}, {
        completed: false,
        projectId: session.projectId,
        progress: {
            current: currentIndex + 1,
            total: chatFlow.FLOW_STEPS.length
        },
        previousAnswers: session.answers
    });
}

async function startChat(projectId, userId = null) {
    if (!projectId) {
        return { error: 'Project ID is required', code: 'MISSING_PROJECT_ID' };
    }

    const access = await sessionStore.requireProjectOwner(projectId, userId);
    if (access.error) {
        return access;
    }

    const session = await sessionStore.createSession(projectId, userId);
    const firstStep = chatFlow.getFirstStep();

    return {
        projectId: session.projectId,
        ...archFocusMode.enrichStepPayload(firstStep, {}, {
            progress: {
                current: 1,
                total: chatFlow.FLOW_STEPS.length
            }
        })
    };
}

async function answerQuestion(projectId, answer, userId = null) {
    const access = await sessionStore.requireProjectOwner(projectId, userId);
    if (access.error) {
        return access;
    }

    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No architecture session found for this project', code: 'SESSION_NOT_FOUND' };
    }

    if (session.completed) {
        return { error: 'Session already completed', code: 'SESSION_COMPLETED' };
    }

    await ensureValidCurrentStep(projectId, session);

    const validation = chatFlow.validateAnswer(session.currentStep, answer);
    if (!validation.valid) {
        return { error: validation.error, code: 'INVALID_ANSWER' };
    }

    const focusValidation = archFocusMode.validateFocusSelection(
        session.currentStep,
        answer,
        session.answers
    );
    if (!focusValidation.valid) {
        return {
            error: focusValidation.error,
            code: focusValidation.code,
            step: focusValidation.step,
            value: focusValidation.value,
            status: focusValidation.status
        };
    }

    const updatedAnswers = {
        ...session.answers,
        [session.currentStep]: answer
    };

    if (chatFlow.isLastStep(session.currentStep)) {
        const focusConfigCheck = archFocusMode.validateFocusConfiguration(updatedAnswers);
        if (!focusConfigCheck.valid) {
            return {
                error: focusConfigCheck.error,
                code: focusConfigCheck.code,
                violations: focusConfigCheck.violations,
                goBackTo: focusConfigCheck.goBackTo,
                currentAnswers: updatedAnswers
            };
        }

        const architecture = ruleEngine.generateArchitecture(updatedAnswers);
        
        if (architecture.blocked) {
            return {
                blocked: true,
                error: architecture.error,
                blockedField: architecture.blockedField,
                blockedValue: architecture.blockedValue,
                details: architecture.details,
                recommendation: architecture.recommendation,
                userMessage: architecture.userMessage,
                goBackTo: getQuestionIdForField(architecture.blockedField),
                currentAnswers: updatedAnswers,
                code: 'CONFIGURATION_BLOCKED'
            };
        }
        
        const formattedResult = responseFormatter.formatFullResponse(architecture);
        const chatSummary = responseFormatter.formatChatResponse(architecture);

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

    const nextStep = chatFlow.getNextStep(session.currentStep);
    
    await sessionStore.updateSession(projectId, {
        currentStep: nextStep.id,
        answers: updatedAnswers
    });

    const currentIndex = chatFlow.FLOW_STEPS.findIndex(s => s.id === nextStep.id);

    return {
        completed: false,
        ...archFocusMode.enrichStepPayload(nextStep, updatedAnswers, {
            progress: {
                current: currentIndex + 1,
                total: chatFlow.FLOW_STEPS.length
            },
            previousAnswers: updatedAnswers
        })
    };
}

async function getSessionState(projectId, userId = null) {
    const access = await sessionStore.requireProjectOwner(projectId, userId);
    if (access.error) {
        return access;
    }

    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No architecture session found for this project', code: 'SESSION_NOT_FOUND' };
    }

    if (session.completed) {
        return {
            completed: true,
            projectId,
            result: responseFormatter.formatFullResponse(session.result),
            chatMessage: responseFormatter.formatChatResponse(session.result),
            answers: session.answers
        };
    }

    await ensureValidCurrentStep(projectId, session);

    const currentStep = chatFlow.getStep(session.currentStep);
    return buildStepResponse(session, currentStep);
}

async function goBack(projectId, userId = null) {
    const access = await sessionStore.requireProjectOwner(projectId, userId);
    if (access.error) {
        return access;
    }

    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No architecture session found for this project', code: 'SESSION_NOT_FOUND' };
    }

    if (session.completed) {
        return { error: 'Session already completed', code: 'SESSION_COMPLETED' };
    }

    await ensureValidCurrentStep(projectId, session);

    const stepIds = chatFlow.getAllStepIds();
    const currentIndex = stepIds.indexOf(session.currentStep);

    if (currentIndex <= 0) {
        return { error: 'Already at first question', code: 'AT_START' };
    }

    const previousStepId = stepIds[currentIndex - 1];
    const previousStep = chatFlow.getStep(previousStepId);

    const updatedAnswers = { ...session.answers };
    delete updatedAnswers[session.currentStep];

    await sessionStore.updateSession(projectId, {
        currentStep: previousStepId,
        answers: updatedAnswers
    });

    return archFocusMode.enrichStepPayload(previousStep, updatedAnswers, {
        progress: {
            current: currentIndex,
            total: chatFlow.FLOW_STEPS.length
        },
        previousAnswers: updatedAnswers
    });
}

async function resetSession(projectId, userId = null) {
    const access = await sessionStore.requireProjectOwner(projectId, userId);
    if (access.error) {
        return access;
    }

    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No architecture session found for this project', code: 'SESSION_NOT_FOUND' };
    }

    const firstStep = chatFlow.getFirstStep();

    await sessionStore.updateSession(projectId, {
        currentStep: firstStep.id,
        reset: true
    });

    return {
        projectId,
        ...archFocusMode.enrichStepPayload(firstStep, {}, {
            progress: {
                current: 1,
                total: chatFlow.FLOW_STEPS.length
            }
        })
    };
}

async function initialize() {
    const focus = archFocusMode.isFocusModeEnabled();
    console.log(`[ArchChat] Service initialized (PostgreSQL storage, focusMode=${focus ? 'small_starter' : 'off'})`);
}

async function getStats() {
    return await sessionStore.getStats();
}

function getQuestionIdForField(fieldName) {
    const fieldToQuestion = {
        'app_type': 'app_type',
        'resource_tier': 'resource_tier',
        'features': 'features',
        'availability': 'availability',
        'traffic': 'traffic',
        'database': 'database',
        'scale': 'scale',
        'team_size': 'team_size',
        'managed_level': 'managed_level',
        'budget': 'budget'
    };
    return fieldToQuestion[fieldName] || fieldName;
}

async function preValidateAnswer(projectId, questionId, proposedAnswer, userId = null) {
    const access = await sessionStore.requireProjectOwner(projectId, userId);
    if (access.error) {
        return access;
    }

    const session = await sessionStore.getSession(projectId);
    if (!session) {
        return { error: 'No session found', code: 'SESSION_NOT_FOUND' };
    }
    
    const focusCheck = archFocusMode.validateFocusSelection(
        questionId,
        proposedAnswer,
        session.answers
    );
    if (!focusCheck.valid) {
        return {
            wouldBlock: true,
            error: focusCheck.error,
            code: focusCheck.code,
            status: focusCheck.status,
            userMessage: focusCheck.error
        };
    }

    const validationResult = ruleEngine.validateProposedAnswer(
        session.answers,
        questionId,
        proposedAnswer
    );
    
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

function formatBlockedWarning(validation) {
    let msg = `This selection would block your configuration:\n\n`;
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
    preValidateAnswer,
    
    chatFlow,
    ruleEngine,
    responseFormatter,
    archFocusMode
};

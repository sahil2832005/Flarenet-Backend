const { wouldAnswerCauseBlock } = require('./resourceCalculator');

// Product decision: which plan is currently live.
// Change ACTIVE_PLAN to unlock additional tiers once they are ready.
// 'starter' → Starter Monolith only (current)
// 'standard' → unlock Production Plan as well
const ACTIVE_PLAN = 'starter';

// Sent in API responses so the frontend knows which mode is active.
// Kept stable so existing frontend code does not need updating.
const ACTIVE_PLAN_LABEL = 'small_starter';

const FOCUS_MESSAGE = 'MVP mode: Simple Monolith on Starter Plan (2 vCPU, 4 GB)';

const RECOMMENDED = {
    app_type: new Set(['webapp']),
    scale: new Set(['small']),
    resource_tier: new Set(['starter']),
    database: new Set(['relational']),
    features: new Set(['auth', 'cache']),
    traffic: new Set(['steady']),
    availability: new Set(['standard']),
    team_size: new Set(['solo']),
    managed_level: new Set(['templates_only']),
    budget: new Set(['minimal'])
};

const OPTIONAL_AVAILABLE = {
    features: new Set(['search', 'files', 'websocket'])
};

const STARTER_REQUIRED_FEATURES = ['auth', 'cache'];

const COMING_SOON = {
    app_type: new Set(['api', 'realtime']),
    scale: new Set(['medium', 'large']),
    resource_tier: new Set(['standard']),
    database: new Set(['document', 'both']),
    features: new Set(['queue']),
    traffic: new Set(['growing', 'spiky']),
    availability: new Set(['high']),
    team_size: new Set(['small', 'medium', 'large']),
    managed_level: new Set(['semi_managed', 'full_managed']),
    budget: new Set(['moderate', 'flexible'])
};

const COMING_SOON_MESSAGES = {
    app_type: {
        api: 'REST API deployments coming after MVP launch.',
        realtime: 'Real-time apps coming after MVP launch.'
    },
    scale: {
        medium: 'Modular Monolith support coming soon.',
        large: 'Microservices architecture coming soon.'
    },
    resource_tier: {
        standard: 'Production Plan (4 vCPU, 99.9%) coming soon.'
    },
    database: {
        document: 'MongoDB option coming soon.',
        both: 'Mixed database setup coming soon.'
    },
    availability: {
        high: '99.9% high availability coming with Production Plan.'
    },
    features: {
        queue: 'Background jobs on Starter coming after MVP launch.'
    },
    traffic: {
        growing: 'Growing traffic patterns coming soon.',
        spiky: 'Spiky traffic handling coming soon.'
    },
    team_size: {
        small: 'Multi-developer team options coming soon.',
        medium: 'Larger team options coming soon.',
        large: 'Enterprise team options coming soon.'
    },
    managed_level: {
        semi_managed: 'Semi-managed deployments coming soon.',
        full_managed: 'Fully managed deployments coming soon.'
    },
    budget: {
        moderate: 'Moderate budget tier coming soon.',
        flexible: 'Flexible budget tier coming soon.'
    }
};

function isFocusModeEnabled() {
    return ACTIVE_PLAN === 'starter';
}

function getFocusMeta() {
    if (!isFocusModeEnabled()) {
        return null;
    }
    return {
        focusMode: ACTIVE_PLAN_LABEL,
        focusMessage: FOCUS_MESSAGE
    };
}

function resolveOptionStatus(stepId, value, previousAnswers) {
    if (!isFocusModeEnabled()) {
        const recommended = RECOMMENDED[stepId]?.has(value);
        return {
            status: recommended ? 'recommended' : 'available',
            statusMessage: recommended ? 'Recommended for MVP' : undefined,
            selectable: true
        };
    }

    // Dynamic Starter rule conflicts
    const proposedAnswer = stepId === 'features'
        ? (Array.isArray(value) ? value : [value])
        : value;
    const dynamicBlock = wouldAnswerCauseBlock(previousAnswers, stepId, proposedAnswer);
    if (!dynamicBlock.valid) {
        return {
            status: 'blocked',
            statusMessage: dynamicBlock.error,
            selectable: false
        };
    }

    if (RECOMMENDED[stepId]?.has(value)) {
        return {
            status: 'recommended',
            statusMessage: 'Recommended for MVP',
            selectable: true
        };
    }

    if (OPTIONAL_AVAILABLE[stepId]?.has(value)) {
        return {
            status: 'available',
            selectable: true
        };
    }

    if (COMING_SOON[stepId]?.has(value)) {
        const messages = COMING_SOON_MESSAGES[stepId] || {};
        return {
            status: 'coming_soon',
            statusMessage: messages[value] || 'Coming soon after MVP launch.',
            selectable: false
        };
    }

    return {
        status: 'available',
        selectable: true
    };
}

function enrichOptions(stepId, options, previousAnswers = {}) {
    return options.map(option => {
        const meta = resolveOptionStatus(stepId, option.value, previousAnswers);
        return {
            ...option,
            status: meta.status,
            statusMessage: meta.statusMessage,
            selectable: meta.selectable
        };
    });
}

function validateStarterFeatures(answer) {
    if (!Array.isArray(answer)) {
        return {
            valid: false,
            code: 'OPTION_NOT_AVAILABLE',
            error: 'Features must be a list.',
            step: 'features',
            value: answer,
            status: 'blocked'
        };
    }

    if (new Set(answer).size !== answer.length) {
        return {
            valid: false,
            code: 'OPTION_NOT_AVAILABLE',
            error: 'Duplicate features are not allowed.',
            step: 'features',
            value: answer,
            status: 'blocked'
        };
    }

    const missing = STARTER_REQUIRED_FEATURES.filter((feature) => !answer.includes(feature));
    if (missing.length > 0) {
        return {
            valid: false,
            code: 'OPTION_NOT_AVAILABLE',
            error: 'Starter requires auth and cache.',
            step: 'features',
            value: answer,
            status: 'blocked'
        };
    }

    return { valid: true };
}

function validateFocusSelection(stepId, answer, previousAnswers = {}) {
    if (!isFocusModeEnabled()) {
        return { valid: true };
    }

    if (stepId === 'features') {
        const featureCheck = validateStarterFeatures(answer);
        if (!featureCheck.valid) {
            return featureCheck;
        }
    }

    const values = Array.isArray(answer) ? answer : [answer];

    for (const value of values) {
        const meta = resolveOptionStatus(stepId, value, previousAnswers);
        if (!meta.selectable) {
            return {
                valid: false,
                code: 'OPTION_NOT_AVAILABLE',
                error: meta.statusMessage || 'This option is not available in MVP mode.',
                step: stepId,
                value,
                status: meta.status
            };
        }
    }

    return { valid: true };
}

function validateFocusConfiguration(answers) {
    if (!isFocusModeEnabled()) {
        return { valid: true };
    }

    const violations = [];

    if (answers.scale !== 'small') {
        violations.push({ field: 'scale', value: answers.scale, message: 'MVP mode requires Small scale (Simple Monolith).' });
    }
    if (answers.resource_tier !== 'starter') {
        violations.push({ field: 'resource_tier', value: answers.resource_tier, message: 'MVP mode requires Starter plan.' });
    }
    if (answers.availability !== 'standard') {
        violations.push({ field: 'availability', value: answers.availability, message: 'MVP mode requires 99% availability (Starter Plan).' });
    }
    const featureCheck = validateStarterFeatures(answers.features);
    if (!featureCheck.valid) {
        violations.push({ field: 'features', value: answers.features, message: featureCheck.error });
    }

    if (violations.length === 0) {
        return { valid: true };
    }

    return {
        valid: false,
        code: 'FOCUS_MODE_VIOLATION',
        error: violations[0].message,
        violations,
        goBackTo: violations[0].field
    };
}

function enrichStepPayload(stepDef, previousAnswers = {}, extra = {}) {
    const payload = {
        step: stepDef.id,
        question: stepDef.question,
        options: enrichOptions(stepDef.id, stepDef.options, previousAnswers),
        multiSelect: stepDef.multiSelect || false,
        ...extra
    };

    const focus = getFocusMeta();
    if (focus) {
        payload.focusMode = focus.focusMode;
        payload.focusMessage = focus.focusMessage;
    }

    return payload;
}

module.exports = {
    isFocusModeEnabled,
    getFocusMeta,
    enrichOptions,
    enrichStepPayload,
    validateFocusSelection,
    validateFocusConfiguration,
    resolveOptionStatus
};

const { getSmallArchitecture, getMediumArchitecture, getLargeArchitecture } = require('./templates');
const { calculateResources, RESOURCE_TIERS, AVAILABILITY_CONFIG, strictValidateConfiguration } = require('./resourceCalculator');
const { isFocusModeEnabled } = require('./archFocusMode');

const STARTER_FEATURES = ['auth', 'cache', 'search', 'files', 'websocket'];

function generateArchitecture(answers) {
    const config = normalizeConfig(answers);
    
    const strictValidation = strictValidateConfiguration(config);
    if (!strictValidation.valid) {
        return {
            blocked: true,
            error: strictValidation.error,
            blockedField: strictValidation.blockedField,
            blockedValue: strictValidation.blockedValue,
            details: strictValidation.details,
            recommendation: strictValidation.recommendation,
            userMessage: formatBlockedMessage(strictValidation)
        };
    }

    const validation = crossValidateConfig(config);
    const resourceAllocation = calculateResources(config);

    let architecture;
    switch (config.scale) {
        case 'small':
            architecture = getSmallArchitecture(config);
            break;
        case 'medium':
            architecture = getMediumArchitecture(config);
            break;
        case 'large':
            architecture = getLargeArchitecture(config);
            break;
        default:
            architecture = getSmallArchitecture(config);
    }

    architecture = applyContextualRules(architecture, config);

    architecture.warnings = [
        ...(architecture.warnings || []),
        ...validation.warnings,
        ...resourceAllocation.warnings
    ];

    architecture.resourceAllocation = resourceAllocation;
    architecture.availabilityConfig = getAvailabilityConfig(config);

    architecture.generatedAt = new Date().toISOString();
    architecture.inputConfig = config;
    if (isFocusModeEnabled()) {
        architecture.starterPlan = buildStarterPlan(config);
    }

    return architecture;
}

function buildStarterPlan(config) {
    const tier = RESOURCE_TIERS.starter;
    return {
        plan: 'starter',
        cpu: tier.cpu,
        memoryMb: tier.memory,
        storageGb: tier.storage,
        replicas: tier.maxReplicas,
        availability: 'standard',
        runtime: 'Node.js monolith',
        database: 'PostgreSQL',
        features: config.features
    };
}

function normalizeConfig(answers) {
    const features = Array.isArray(answers.features) ? answers.features : [];
    const config = {
        app_type: answers.app_type || 'webapp',
        scale: answers.scale || 'small',
        database: answers.database || 'relational',
        features: [...new Set(features)],
        traffic: answers.traffic || 'steady',
        budget: answers.budget || (isFocusModeEnabled() ? 'minimal' : 'moderate'),
        resource_tier: answers.resource_tier || (isFocusModeEnabled() ? 'starter' : 'standard'),
        team_size: answers.team_size || (isFocusModeEnabled() ? 'solo' : 'small'),
        availability: answers.availability || 'standard',
        managed_level: answers.managed_level || 'templates_only'
    };

    if (!isFocusModeEnabled()) {
        return config;
    }

    config.app_type = 'webapp';
    config.scale = 'small';
    config.resource_tier = 'starter';
    config.database = 'relational';
    config.traffic = 'steady';
    config.availability = 'standard';
    config.team_size = 'solo';
    config.managed_level = 'templates_only';
    config.budget = 'minimal';
    config.features = config.features.filter((feature) => STARTER_FEATURES.includes(feature));
    for (const required of ['auth', 'cache']) {
        if (!config.features.includes(required)) {
            config.features.push(required);
        }
    }
    return config;
}

function crossValidateConfig(config) {
    const warnings = [];
    const recommendations = [];

    // Rule: Resource tier vs Availability
    const tier = RESOURCE_TIERS[config.resource_tier];
    const availability = AVAILABILITY_CONFIG[config.availability];
    
    if (tier && availability) {
        if (availability.appReplicas > tier.maxReplicas) {
            warnings.push({
                type: 'resource_availability_mismatch',
                severity: 'critical',
                message: `${config.availability} availability requires ${availability.appReplicas} replicas, but ${tier.name} tier only supports ${tier.maxReplicas} replicas.`,
                recommendation: `Upgrade to a higher resource tier or reduce availability requirement.`,
                context: {
                    currentTier: config.resource_tier,
                    requiredReplicas: availability.appReplicas,
                    maxSupported: tier.maxReplicas
                }
            });
        }
    }

    // Rule: Team size vs Architecture complexity
    if (config.team_size === 'solo' && config.app_type === 'microservices') {
        warnings.push({
            type: 'team_complexity_mismatch',
            severity: 'warning',
            message: 'Microservices architecture is complex for a 1-2 person team.',
            recommendation: 'Consider starting with a modular monolith that can be split into microservices later.',
            context: {
                teamSize: config.team_size,
                appType: config.app_type
            }
        });
    }

    // Rule: Features vs Resource tier
    const heavyFeatures = config.features.filter(f => ['queue', 'search', 'websocket'].includes(f));
    if (heavyFeatures.length >= 2 && config.resource_tier === 'starter') {
        warnings.push({
            type: 'features_tier_mismatch',
            severity: 'warning',
            message: `Multiple resource-intensive features (${heavyFeatures.join(', ')}) selected with Starter tier.`,
            recommendation: 'Upgrade to Standard tier or reduce features for initial launch.',
            context: {
                features: heavyFeatures,
                tier: config.resource_tier
            }
        });
    }

    return { warnings, recommendations, isValid: warnings.filter(w => w.severity === 'critical').length === 0 };
}

function getAvailabilityConfig(config) {
    const availConfig = AVAILABILITY_CONFIG[config.availability] || AVAILABILITY_CONFIG.standard;
    
    return {
        level: config.availability,
        sla: config.availability === 'standard' ? '99%' : config.availability === 'high' ? '99.9%' : '99.99%',
        appReplicas: availConfig.appReplicas,
        dbReplicas: availConfig.dbReplicas,
        restartPolicy: availConfig.restartPolicy,
        healthCheck: {
            interval: `${availConfig.healthCheckInterval}s`,
            timeout: '5s',
            retries: 3
        },
        failover: availConfig.failoverTime ? {
            enabled: true,
            detectionTime: `${availConfig.failoverTime}s`,
            automatic: true
        } : {
            enabled: false
        }
    };
}

/**
 * Apply contextual rules to modify architecture
 */
function applyContextualRules(architecture, config) {
    const warnings = [];
    const recommendations = [];

    // Rule: Microservices warning for small scale
    if (config.app_type === 'microservices' && config.scale === 'small') {
        warnings.push({
            type: 'consideration',
            message: 'Microservices add complexity. For small scale, consider starting with a modular monolith that can be split later.'
        });
    }

    // Rule: Real-time + spiky traffic
    if (config.app_type === 'realtime' && config.traffic === 'spiky') {
        recommendations.push({
            type: 'scaling',
            message: 'Real-time apps with spiky traffic need aggressive auto-scaling. Consider connection pooling and rate limiting per user.'
        });
    }

    // Rule: Multiple features + small scale
    if (config.features.length > 4 && config.scale === 'small') {
        warnings.push({
            type: 'complexity',
            message: 'Many features selected for small scale. Consider prioritizing and implementing incrementally.'
        });
    }

    // Rule: Minimal budget + large scale
    if (config.budget === 'minimal' && config.scale === 'large') {
        warnings.push({
            type: 'budget',
            message: 'Large scale architecture requires significant investment. Consider starting smaller and scaling up.'
        });
    }

    // Rule: Document DB + complex relationships
    if (config.database === 'document' && config.scale === 'large') {
        recommendations.push({
            type: 'database',
            message: 'If you have complex relationships, consider a relational database with document storage for specific use cases.'
        });
    }

    // Rule: Search feature importance
    if (config.features.includes('search') && config.scale !== 'small') {
        recommendations.push({
            type: 'search',
            message: 'Invest in search infrastructure early. Migrating search solutions later is complex.'
        });
    }

    // Rule: Authentication best practices
    if (config.features.includes('auth')) {
        recommendations.push({
            type: 'security',
            message: 'Implement rate limiting on auth endpoints from day one. Use secure password hashing (bcrypt/argon2).'
        });
    }

    // Add warnings and recommendations to architecture
    architecture.warnings = warnings;
    architecture.recommendations = recommendations;

    return architecture;
}

/**
 * Get a quick summary for the chat
 */
function getQuickSummary(architecture) {
    const stack = [];

    if (architecture.backend) {
        stack.push(`Backend: ${architecture.backend.framework}`);
    }
    if (architecture.database?.primary) {
        stack.push(`Database: ${architecture.database.primary.type}`);
    }
    if (architecture.cache) {
        stack.push(`Cache: ${architecture.cache.type}`);
    }
    if (architecture.deployment) {
        stack.push(`Deploy: ${architecture.deployment.platform}`);
    }

    return {
        name: architecture.name,
        tier: architecture.tier,
        stack,
        cost: architecture.estimatedCost?.range || 'Variable'
    };
}

/**
 * Validate if config is complete for generation
 */
function isConfigComplete(answers) {
    const required = ['app_type', 'scale', 'database', 'features', 'traffic', 'budget'];
    return required.every(key => answers.hasOwnProperty(key));
}

/**
 * Format a blocked validation result into a user-friendly message
 */
function formatBlockedMessage(validation) {
    const { error, blockedField, blockedValue, recommendation } = validation;

    let message = `Configuration Blocked\n\n`;
    message += `${error}\n\n`;
    message += `Selected: ${blockedField} = "${blockedValue}"\n\n`;
    message += `Options:\n`;

    if (recommendation) {
        Object.keys(recommendation).forEach((key, index) => {
            const opt = recommendation[key];
            message += `${index + 1}. ${opt.action}\n   ${opt.result}\n`;
        });
    }

    return message;
}

/**
 * Check if a proposed answer would be blocked BEFORE user commits
 * Used by chat flow to warn user in real-time
 */
function validateProposedAnswer(currentAnswers, questionId, proposedAnswer) {
    const { wouldAnswerCauseBlock } = require('./resourceCalculator');
    return wouldAnswerCauseBlock(currentAnswers, questionId, proposedAnswer);
}

module.exports = {
    generateArchitecture,
    normalizeConfig,
    crossValidateConfig,
    getQuickSummary,
    isConfigComplete,
    getAvailabilityConfig,
    formatBlockedMessage,
    validateProposedAnswer
};

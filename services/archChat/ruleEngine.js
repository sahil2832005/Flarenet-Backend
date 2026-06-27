/**
 * Rule Engine - Core Logic for Architecture Recommendations
 * Deterministic, no AI - just rules and templates
 * Phase 2: Added resource calculation and cross-validation
 * Phase 2.1: Added STRICT validation - blocks invalid combinations
 */

const { getSmallArchitecture, getMediumArchitecture, getLargeArchitecture } = require('./templates');
const { calculateResources, RESOURCE_TIERS, AVAILABILITY_CONFIG, strictValidateConfiguration } = require('./resourceCalculator');
const { generateComplianceConfig, checkNetworkCompliance, getMinimumNetworkIsolation } = require('./complianceConfig');

/**
 * Generate architecture recommendation based on user answers
 * THROWS ConfigurationBlockedError if invalid combination detected
 */
function generateArchitecture(answers) {
    const config = normalizeConfig(answers);
    
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2.1: STRICT VALIDATION - BLOCKS INVALID COMBINATIONS
    // This is NOT a warning. If invalid, we STOP and tell user what to fix.
    // ═══════════════════════════════════════════════════════════════════════
    const strictValidation = strictValidateConfiguration(config);
    if (!strictValidation.valid) {
        // Return a blocked response instead of generating architecture
        return {
            blocked: true,
            error: strictValidation.error,
            blockedField: strictValidation.blockedField,
            blockedValue: strictValidation.blockedValue,
            details: strictValidation.details,
            recommendation: strictValidation.recommendation,
            // Help frontend show the right message
            userMessage: formatBlockedMessage(strictValidation)
        };
    }
    // ═══════════════════════════════════════════════════════════════════════
    
    // Phase 2: Cross-validate configuration (soft warnings only now)
    const validation = crossValidateConfig(config);
    
    // Phase 2: Calculate resource allocation
    const resourceAllocation = calculateResources(config);
    
    // Phase 2: Generate compliance configuration
    const complianceConfig = generateComplianceConfig(config.compliance, config.network_isolation);
    
    // Select base architecture based on scale
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

    // Apply additional rules and modifications
    architecture = applyContextualRules(architecture, config);
    
    // Phase 2: Merge validation warnings
    architecture.warnings = [
        ...(architecture.warnings || []),
        ...validation.warnings,
        ...resourceAllocation.warnings,
        ...(complianceConfig.warnings || [])
    ];
    
    // Phase 2: Add resource allocation to architecture
    architecture.resourceAllocation = resourceAllocation;
    
    // Phase 2: Add compliance config to architecture
    architecture.compliance = complianceConfig;
    
    // Phase 2: Add availability configuration
    architecture.availabilityConfig = getAvailabilityConfig(config);
    
    // Phase 2: Add network configuration
    architecture.networkConfig = getNetworkConfig(config);

    // Add metadata
    architecture.generatedAt = new Date().toISOString();
    architecture.inputConfig = config;

    return architecture;
}

/**
 * Normalize user answers into config object
 */
function normalizeConfig(answers) {
    return {
        // Original fields
        app_type: answers.app_type || 'webapp',
        scale: answers.scale || 'small',
        database: answers.database || 'relational',
        features: Array.isArray(answers.features) ? answers.features : [],
        traffic: answers.traffic || 'steady',
        budget: answers.budget || 'moderate',
        // Phase 1: New enterprise fields
        resource_tier: answers.resource_tier || 'standard',
        compliance: Array.isArray(answers.compliance) ? answers.compliance : ['none'],
        team_size: answers.team_size || 'small',
        availability: answers.availability || 'standard',
        network_isolation: answers.network_isolation || 'shared',
        managed_level: answers.managed_level || 'templates_only'
    };
}

/**
 * Phase 2: Cross-validate configuration for conflicts
 */
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

    // Rule: Compliance vs Network Isolation
    if (!config.compliance.includes('none')) {
        const networkWarnings = checkNetworkCompliance(config.compliance, config.network_isolation);
        networkWarnings.forEach(nw => {
            warnings.push({
                type: 'compliance_network_mismatch',
                severity: 'critical',
                message: `${nw.standard} requires "${nw.required}" network isolation, but you selected "${nw.current}".`,
                recommendation: `Upgrade network isolation to "${nw.required}" or higher to meet ${nw.standard} compliance.`,
                context: {
                    standard: nw.standard,
                    required: nw.required,
                    current: nw.current
                }
            });
        });
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

    // Rule: Team size vs Managed level
    if (config.team_size === 'solo' && config.managed_level === 'templates_only' && config.compliance.length > 1) {
        recommendations.push({
            type: 'management_suggestion',
            message: 'With compliance requirements and a small team, consider "Semi-Managed" or "Fully Managed" to reduce operational burden.',
            context: {
                teamSize: config.team_size,
                managedLevel: config.managed_level,
                complianceCount: config.compliance.length
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

    // Rule: Compliance + Managed level
    const strictCompliance = config.compliance.filter(c => ['hipaa', 'pci'].includes(c));
    if (strictCompliance.length > 0 && config.managed_level === 'templates_only') {
        recommendations.push({
            type: 'compliance_management_suggestion',
            message: `${strictCompliance.join(' and ')} compliance requires ongoing monitoring and audit logs. Consider "Semi-Managed" or "Fully Managed" service.`,
            context: {
                compliance: strictCompliance,
                managedLevel: config.managed_level
            }
        });
    }

    return { warnings, recommendations, isValid: warnings.filter(w => w.severity === 'critical').length === 0 };
}

/**
 * Phase 2: Get availability configuration
 */
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
 * Phase 2: Get network configuration
 */
function getNetworkConfig(config) {
    const networkConfigs = {
        shared: {
            type: 'Shared Network',
            isolation: 'container-level',
            publicAccess: true,
            internalDns: true,
            firewall: {
                enabled: true,
                rules: 'standard'
            }
        },
        dedicated_vlan: {
            type: 'Dedicated VLAN',
            isolation: 'network-segment',
            vlanId: 'auto-assigned',
            subnet: '10.x.x.0/24',
            publicAccess: true,
            internalDns: true,
            firewall: {
                enabled: true,
                rules: 'strict'
            }
        },
        private: {
            type: 'Private Network',
            isolation: 'fully-isolated',
            publicAccess: false,
            vpnRequired: true,
            internalDns: true,
            firewall: {
                enabled: true,
                rules: 'strict',
                egressWhitelist: true
            }
        }
    };

    return networkConfigs[config.network_isolation] || networkConfigs.shared;
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
    
    // NOTE: compute removed - shown in Resources tab
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
    
    let message = `❌ **Configuration Blocked**\n\n`;
    message += `${error}\n\n`;
    message += `**What you selected:** ${blockedField} = "${blockedValue}"\n\n`;
    message += `**Your options:**\n`;
    
    if (recommendation) {
        Object.keys(recommendation).forEach((key, index) => {
            const opt = recommendation[key];
            message += `${index + 1}. **${opt.action}**\n   → ${opt.result}\n`;
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
    getNetworkConfig,
    formatBlockedMessage,
    validateProposedAnswer
};

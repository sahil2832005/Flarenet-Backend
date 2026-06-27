/**
 * Resource Calculator - Phase 2
 * Calculates exact CPU/memory allocations based on resource tier and requirements
 * 
 * AVAILABLE PLANS:
 * 1. Starter + Standard (2 CPU, 4GB, 99% SLA)
 * 2. Standard + High (4 CPU, 8GB, 99.9% SLA)
 */

/**
 * Resource tier definitions (bare metal allocations)
 * Only Starter and Standard tiers are available
 */
const RESOURCE_TIERS = {
    starter: {
        name: 'Starter',
        cpu: 2,           // vCPU
        memory: 4096,     // MB (4GB)
        storage: 50,      // GB
        maxReplicas: 1,   // Can't do HA
        maxContainers: 4,
        allowedAvailability: ['standard'],  // Only 99% SLA
        description: 'Best for MVPs, prototypes, dev environments'
    },
    standard: {
        name: 'Standard',
        cpu: 4,
        memory: 8192,     // MB (8GB)
        storage: 100,
        maxReplicas: 3,
        maxContainers: 6,
        allowedAvailability: ['standard', 'high'],  // 99% or 99.9% SLA
        description: 'Best for production apps, growing startups'
    }
};

/**
 * Base resource requirements per container type
 */
const CONTAINER_REQUIREMENTS = {
    app: {
        minCpu: 0.5,
        minMemory: 512,
        recommendedCpu: 1,
        recommendedMemory: 1024,
        scalable: true
    },
    database: {
        postgres: {
            minCpu: 0.5,
            minMemory: 1024,
            recommendedCpu: 1,
            recommendedMemory: 2048
        },
        mongodb: {
            minCpu: 0.5,
            minMemory: 1024,
            recommendedCpu: 1,
            recommendedMemory: 2048
        }
    },
    redis: {
        minCpu: 0.25,
        minMemory: 256,
        recommendedCpu: 0.5,
        recommendedMemory: 512
    },
    nginx: {
        minCpu: 0.1,
        minMemory: 128,
        recommendedCpu: 0.25,
        recommendedMemory: 256
    },
    worker: {
        minCpu: 0.25,
        minMemory: 256,
        recommendedCpu: 0.5,
        recommendedMemory: 512
    }
};

/**
 * Availability to replica mapping
 * Only Standard (99%) and High (99.9%) are available
 */
const AVAILABILITY_CONFIG = {
    standard: {
        name: '99% SLA',
        appReplicas: 1,
        dbReplicas: 0,          // No replica
        redisReplicas: 0,
        restartPolicy: 'on-failure',
        healthCheckInterval: 30,
        failoverTime: null,     // No auto-failover
        requiredTier: 'starter', // Minimum tier required
        description: 'Single container with basic restarts'
    },
    high: {
        name: '99.9% SLA',
        appReplicas: 2,
        dbReplicas: 1,          // Read replica
        redisReplicas: 0,       // Redis Sentinel not needed at this level
        restartPolicy: 'always',
        healthCheckInterval: 15,
        failoverTime: 60,       // 60 second failover
        requiredTier: 'standard', // Minimum tier required
        description: 'Multiple replicas with health checks'
    }
};

/**
 * Calculate resource allocation for all containers
 * @param {Object} config - User configuration from answers
 * @returns {Object} - Resource allocation breakdown
 */
function calculateResources(config) {
    const tier = RESOURCE_TIERS[config.resource_tier] || RESOURCE_TIERS.standard;
    const availability = AVAILABILITY_CONFIG[config.availability] || AVAILABILITY_CONFIG.standard;
    
    const allocation = {
        tier: {
            name: tier.name,
            totalCpu: tier.cpu,
            totalMemory: tier.memory,
            totalStorage: tier.storage
        },
        containers: [],
        summary: {
            usedCpu: 0,
            usedMemory: 0,
            remainingCpu: 0,
            remainingMemory: 0,
            utilizationPercent: 0
        },
        warnings: []
    };

    // Calculate app container resources
    const appReplicas = Math.min(availability.appReplicas, tier.maxReplicas);
    const appResources = calculateAppResources(config, tier, appReplicas);
    allocation.containers.push(appResources);

    // Calculate database resources
    const dbResources = calculateDatabaseResources(config, tier, availability);
    allocation.containers.push(dbResources);

    // Calculate Redis if needed
    if (config.features.includes('cache') || config.features.includes('queue')) {
        const redisResources = calculateRedisResources(config, tier, availability);
        allocation.containers.push(redisResources);
    }

    // Calculate Nginx
    const nginxResources = calculateNginxResources(tier);
    allocation.containers.push(nginxResources);

    // Calculate worker if background jobs needed
    if (config.features.includes('queue')) {
        const workerResources = calculateWorkerResources(config, tier);
        allocation.containers.push(workerResources);
    }

    // Calculate totals
    let totalCpu = 0;
    let totalMemory = 0;

    allocation.containers.forEach(container => {
        totalCpu += container.cpu * container.replicas;
        totalMemory += container.memory * container.replicas;
    });

    allocation.summary.usedCpu = Math.round(totalCpu * 100) / 100;
    allocation.summary.usedMemory = totalMemory;
    allocation.summary.remainingCpu = Math.round((tier.cpu - totalCpu) * 100) / 100;
    allocation.summary.remainingMemory = tier.memory - totalMemory;
    allocation.summary.utilizationPercent = Math.round((totalCpu / tier.cpu) * 100);

    // Check for resource overflow
    if (totalCpu > tier.cpu || totalMemory > tier.memory) {
        allocation.warnings.push({
            type: 'resource_overflow',
            severity: 'critical',
            message: `Selected configuration exceeds ${tier.name} tier capacity.`,
            details: {
                cpuOver: totalCpu > tier.cpu ? totalCpu - tier.cpu : 0,
                memoryOver: totalMemory > tier.memory ? totalMemory - tier.memory : 0
            },
            recommendation: getUpgradeRecommendation(config.resource_tier)
        });
    }

    // Check for replica mismatch
    if (availability.appReplicas > tier.maxReplicas) {
        allocation.warnings.push({
            type: 'replica_mismatch',
            severity: 'warning',
            message: `${config.availability} availability needs ${availability.appReplicas} replicas, but ${tier.name} tier only supports ${tier.maxReplicas}.`,
            recommendation: getUpgradeRecommendation(config.resource_tier)
        });
    }

    return allocation;
}

/**
 * Calculate app container resources
 */
function calculateAppResources(config, tier, replicas) {
    const base = CONTAINER_REQUIREMENTS.app;
    
    // Adjust for app type
    let cpuMultiplier = 1;
    let memoryMultiplier = 1;
    
    if (config.app_type === 'realtime') {
        memoryMultiplier = 1.5;  // WebSocket connections need more memory
    }
    if (config.app_type === 'api') {
        cpuMultiplier = 1.2;     // API-heavy needs more CPU
    }

    // Calculate based on available resources and replicas
    const availableCpu = tier.cpu * 0.4;  // 40% for app
    const availableMemory = tier.memory * 0.35;  // 35% for app
    
    const cpuPerReplica = Math.max(
        base.minCpu,
        Math.min(base.recommendedCpu * cpuMultiplier, availableCpu / replicas)
    );
    
    const memoryPerReplica = Math.max(
        base.minMemory,
        Math.min(base.recommendedMemory * memoryMultiplier, availableMemory / replicas)
    );

    return {
        name: 'app',
        type: 'application',
        image: config.app_type === 'realtime' ? 'node:20-slim (Socket.io)' : 'node:20-slim',
        cpu: Math.round(cpuPerReplica * 100) / 100,
        memory: Math.round(memoryPerReplica),
        replicas: replicas,
        scalable: true,
        ports: ['3000'],
        healthCheck: {
            path: '/health',
            interval: AVAILABILITY_CONFIG[config.availability]?.healthCheckInterval || 30
        }
    };
}

/**
 * Calculate database resources
 */
function calculateDatabaseResources(config, tier, availability) {
    const dbType = config.database === 'document' ? 'mongodb' : 'postgres';
    const base = CONTAINER_REQUIREMENTS.database[dbType];
    
    // Database gets priority allocation
    const cpuAllocation = tier.cpu * 0.3;  // 30% for DB
    const memoryAllocation = tier.memory * 0.35;  // 35% for DB
    
    const totalReplicas = 1 + availability.dbReplicas;
    
    return {
        name: 'database',
        type: dbType,
        image: dbType === 'mongodb' ? 'mongo:7' : 'postgres:16-alpine',
        cpu: Math.round(Math.min(base.recommendedCpu, cpuAllocation / totalReplicas) * 100) / 100,
        memory: Math.round(Math.min(base.recommendedMemory * 1.5, memoryAllocation / totalReplicas)),
        replicas: 1,
        readReplicas: availability.dbReplicas,
        persistent: true,
        volumes: ['/data'],
        backup: {
            enabled: true,
            frequency: 'daily',
            retention: config.compliance.includes('hipaa') ? '6 years' : '30 days'
        }
    };
}

/**
 * Calculate Redis resources
 */
function calculateRedisResources(config, tier, availability) {
    const base = CONTAINER_REQUIREMENTS.redis;
    
    // Redis gets smaller allocation
    const cpuAllocation = tier.cpu * 0.1;
    let memoryAllocation = tier.memory * 0.1;
    
    // Increase Redis memory if heavy caching expected
    if (config.traffic === 'spiky') {
        memoryAllocation *= 1.5;
    }

    return {
        name: 'redis',
        type: 'cache',
        image: 'redis:7-alpine',
        cpu: Math.round(Math.min(base.recommendedCpu, cpuAllocation) * 100) / 100,
        memory: Math.round(Math.min(base.recommendedMemory * 2, memoryAllocation)),
        replicas: 1,
        sentinel: availability.redisReplicas > 0,
        sentinelReplicas: availability.redisReplicas,
        persistent: true,
        use: [
            config.features.includes('cache') ? 'Response caching' : null,
            config.features.includes('queue') ? 'Job queues (BullMQ)' : null,
            config.features.includes('auth') ? 'Session storage' : null,
            'Rate limiting'
        ].filter(Boolean)
    };
}

/**
 * Calculate Nginx resources
 */
function calculateNginxResources(tier) {
    const base = CONTAINER_REQUIREMENTS.nginx;
    
    return {
        name: 'nginx',
        type: 'proxy',
        image: 'nginx:alpine',
        cpu: base.recommendedCpu,
        memory: base.recommendedMemory,
        replicas: 1,
        ports: ['80', '443'],
        features: [
            'Reverse proxy',
            'SSL termination',
            'Rate limiting',
            'Gzip compression'
        ]
    };
}

/**
 * Calculate worker resources
 */
function calculateWorkerResources(config, tier) {
    const base = CONTAINER_REQUIREMENTS.worker;
    
    return {
        name: 'worker',
        type: 'background',
        image: 'node:20-slim',
        cpu: base.recommendedCpu,
        memory: base.recommendedMemory,
        replicas: 1,
        scalable: true,
        processes: [
            'Queue processing',
            'Email sending',
            config.features.includes('files') ? 'File processing' : null
        ].filter(Boolean)
    };
}

/**
 * Get upgrade recommendation based on current tier
 * Only Starter and Standard tiers are available
 */
function getUpgradeRecommendation(currentTier) {
    const upgrades = {
        starter: 'Upgrade to Standard tier (4 vCPU, 8GB RAM) for more resources and 99.9% availability',
        standard: 'Standard tier is our highest tier. Contact support for custom requirements.'
    };
    return upgrades[currentTier] || upgrades.starter;
}

/**
 * Get tier info
 */
function getTierInfo(tierName) {
    return RESOURCE_TIERS[tierName] || RESOURCE_TIERS.standard;
}

/**
 * Get availability info
 */
function getAvailabilityInfo(availabilityLevel) {
    return AVAILABILITY_CONFIG[availabilityLevel] || AVAILABILITY_CONFIG.standard;
}

/**
 * Check if configuration is feasible
 */
function isConfigurationFeasible(config) {
    const allocation = calculateResources(config);
    return allocation.warnings.filter(w => w.severity === 'critical').length === 0;
}

/**
 * STRICT VALIDATION - Blocks invalid combinations before architecture generation
 * Returns { valid: true } or { valid: false, error, recommendation, blockedField }
 * 
 * AVAILABLE PLANS:
 * 1. Starter + Standard (2 CPU, 4GB, 99% SLA) - For MVPs
 * 2. Standard + High (4 CPU, 8GB, 99.9% SLA) - For Production
 * 
 * This is NOT a warning - it's a HARD BLOCK. User must change their selection.
 */
function strictValidateConfiguration(config) {
    const tier = config.resource_tier || 'standard';
    const appType = config.app_type || 'webapp';
    const features = config.features || [];
    const availability = config.availability || 'standard';
    const traffic = config.traffic || 'steady';
    const compliance = config.compliance || [];
    const networkIsolation = config.network_isolation || 'shared';
    
    // ═══════════════════════════════════════════════════════════════════════
    // PLAN COMPATIBILITY CHECK
    // Starter can only use Standard availability (99%)
    // Standard can use both Standard (99%) and High (99.9%) availability
    // ═══════════════════════════════════════════════════════════════════════
    
    // BLOCK: Starter tier with High availability (invalid plan)
    if (tier === 'starter' && availability === 'high') {
        return {
            valid: false,
            blockedField: 'availability',
            blockedValue: 'high',
            error: '99.9% availability requires Standard tier or higher.',
            details: {
                reason: 'Starter tier only supports 1 replica (maxReplicas: 1). 99.9% availability needs 2 replicas.',
                allowedCombination: 'Starter tier only works with 99% (Standard) availability.',
            },
            recommendation: {
                option1: {
                    action: 'Select "99%" availability',
                    result: 'Stay on Starter tier with single replica and basic restarts'
                },
                option2: {
                    action: 'Upgrade to Standard tier',
                    result: 'Get 4 CPU, 8GB RAM - enables 99.9% availability with 2 replicas'
                }
            }
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STARTER TIER RESOURCE RESTRICTIONS (2 CPU, 4GB RAM)
    // ═══════════════════════════════════════════════════════════════════════
    if (tier === 'starter') {
        
        // BLOCK: Queue feature on Starter (adds Worker = +0.5 CPU, causes overflow)
        if (features.includes('queue')) {
            return {
                valid: false,
                blockedField: 'features',
                blockedValue: 'queue',
                error: 'Background Jobs (queue) requires more resources than Starter tier provides.',
                details: {
                    reason: 'Queue adds a Worker container (+0.5 CPU, +512 MB) causing CPU overflow.',
                    currentUsage: 'Would use 2.35 CPU out of 2.0 available (117%)',
                },
                recommendation: {
                    option1: {
                        action: 'Remove "Background Jobs" from features',
                        result: 'Stay on Starter tier without queue processing'
                    },
                    option2: {
                        action: 'Upgrade to Standard tier',
                        result: 'Get 4 CPU, 8GB RAM - enough for all features'
                    }
                }
            };
        }
        
        // BLOCK: API app type with cache on Starter (100% CPU usage)
        if (appType === 'api' && features.includes('cache')) {
            return {
                valid: false,
                blockedField: 'features',
                blockedValue: 'cache',
                error: 'REST API with Caching exceeds Starter tier capacity.',
                details: {
                    reason: 'API apps need +20% CPU. Combined with Redis cache, this maxes out resources.',
                    currentUsage: 'Would use 2.01 CPU out of 2.0 available (100%)',
                },
                recommendation: {
                    option1: {
                        action: 'Change app type to "Web Application"',
                        result: 'Web apps use less CPU, fits comfortably'
                    },
                    option2: {
                        action: 'Remove "Caching" from features',
                        result: 'API without cache fits on Starter'
                    },
                    option3: {
                        action: 'Upgrade to Standard tier',
                        result: 'Get 4 CPU - plenty of headroom for API + cache'
                    }
                }
            };
        }
        
        // BLOCK: Realtime app with cache AND spiky traffic on Starter
        if (appType === 'realtime' && features.includes('cache') && traffic === 'spiky') {
            return {
                valid: false,
                blockedField: 'traffic',
                blockedValue: 'spiky',
                error: 'Real-time app with cache cannot handle spiky traffic on Starter tier.',
                details: {
                    reason: 'Real-time apps need +50% memory. Spiky traffic adds +50% to Redis. Combined = no buffer.',
                    currentUsage: 'Would use 3739 MB out of 4096 MB (91%) with no buffer for spikes',
                },
                recommendation: {
                    option1: {
                        action: 'Change traffic pattern to "Steady" or "Growing"',
                        result: 'Reduces Redis memory requirement'
                    },
                    option2: {
                        action: 'Upgrade to Standard tier',
                        result: 'Get 8GB RAM - handles spiky real-time apps'
                    }
                }
            };
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // COMPLIANCE + NETWORK RESTRICTIONS (applies to both tiers)
    // ═══════════════════════════════════════════════════════════════════════
    
    // BLOCK: HIPAA/PCI on shared network
    if ((compliance.includes('hipaa') || compliance.includes('pci')) && networkIsolation === 'shared') {
        return {
            valid: false,
            blockedField: 'network_isolation',
            blockedValue: 'shared',
            error: `${compliance.includes('hipaa') ? 'HIPAA' : 'PCI-DSS'} compliance requires dedicated network isolation.`,
            details: {
                reason: 'Protected health data (HIPAA) and payment card data (PCI) cannot be on shared networks.',
                complianceRequirement: 'Network segmentation is mandatory for these standards.',
            },
            recommendation: {
                option1: {
                    action: 'Select "Dedicated VLAN" network isolation',
                    result: 'Meets minimum compliance requirement'
                },
                option2: {
                    action: 'Select "Private Network" for maximum isolation',
                    result: 'Fully isolated - recommended for sensitive data'
                }
            }
        };
    }
    
    // All validations passed
    return { valid: true };
}

/**
 * Get the valid plan combinations
 * Used by frontend to show available options
 */
function getValidPlanCombinations() {
    return [
        {
            id: 'starter_standard',
            name: 'Starter Plan',
            tier: 'starter',
            availability: 'standard',
            specs: { cpu: 2, memory: '4GB', storage: '50GB', replicas: 1 },
            sla: '99%',
            bestFor: 'MVPs, prototypes, dev environments',
            priceRange: '$20-65/month'
        },
        {
            id: 'standard_high',
            name: 'Production Plan',
            tier: 'standard',
            availability: 'high',
            specs: { cpu: 4, memory: '8GB', storage: '100GB', replicas: 2 },
            sla: '99.9%',
            bestFor: 'Production apps, growing startups, HIPAA/SOC2',
            priceRange: '$100-230/month'
        }
    ];
}

/**
 * Quick check if a specific answer would cause a block
 * Used during question flow to warn user before they commit
 */
function wouldAnswerCauseBlock(currentAnswers, questionId, proposedAnswer) {
    // Create temporary config with the proposed answer
    const tempConfig = { ...currentAnswers };
    
    // Map question ID to config field
    const fieldMap = {
        'app_type': 'app_type',
        'resource_tier': 'resource_tier',
        'features': 'features',
        'compliance': 'compliance',
        'availability': 'availability',
        'network_isolation': 'network_isolation',
        'traffic': 'traffic'
    };
    
    if (fieldMap[questionId]) {
        tempConfig[fieldMap[questionId]] = proposedAnswer;
    }
    
    return strictValidateConfiguration(tempConfig);
}

module.exports = {
    RESOURCE_TIERS,
    AVAILABILITY_CONFIG,
    calculateResources,
    getTierInfo,
    getAvailabilityInfo,
    isConfigurationFeasible,
    strictValidateConfiguration,
    wouldAnswerCauseBlock,
    getValidPlanCombinations
};

const { RESOURCE_TIERS, AVAILABILITY_CONFIG } = require('../resourceCalculator');

function getSmallArchitecture(config) {
    const { app_type, database, features, traffic, budget, resource_tier, availability, team_size } = config;

    const tierSpecs = RESOURCE_TIERS[resource_tier] || RESOURCE_TIERS.starter;
    const availConfig = AVAILABILITY_CONFIG[availability] || AVAILABILITY_CONFIG.standard;

    const architecture = {
        name: team_size === 'solo' ? 'Simple Monolith (Solo-friendly)' : 'Simple Monolith',
        tier: 'small',
        resourceTier: resource_tier,

        backend: {
            framework: app_type === 'realtime' ? 'Node.js + Socket.io' : 'Node.js + Express',
            structure: 'Monolithic',
            api: 'REST API',
            replicas: Math.min(availConfig.appReplicas, tierSpecs.maxReplicas),
            notes: team_size === 'solo' 
                ? 'Single codebase, minimal ops overhead - perfect for small teams'
                : 'Single codebase, easy to develop and deploy'
        },

        database: {
            primary: database === 'document' 
                ? { 
                    type: 'MongoDB', 
                    recommendation: 'MongoDB in Docker container',
                    setup: availConfig.dbReplicas > 0 ? 'Replica set for HA' : 'Single instance with data volume'
                  }
                : { 
                    type: 'PostgreSQL', 
                    recommendation: 'PostgreSQL in Docker container',
                    setup: availConfig.dbReplicas > 0 ? 'Primary + read replica' : 'Single instance with data volume'
                  },
            orm: database === 'document' ? 'Mongoose' : 'Prisma',
            backup: 'Daily pg_dump/mongodump to backup location',
            replicas: availConfig.dbReplicas
        },

        cache: features.includes('cache') ? {
            type: 'Redis',
            recommendation: 'Redis in Docker container',
            use: 'Session storage, API caching',
            sizing: tierSpecs.memory <= 4096 ? '256MB' : '512MB'
        } : null,

        queue: features.includes('queue') ? {
            type: 'BullMQ + Redis',
            recommendation: 'Same Redis instance as cache',
            use: 'Email sending, background tasks'
        } : null,

        storage: features.includes('files') ? {
            type: 'Local Storage',
            recommendation: 'Server filesystem with Docker volume',
            backup: 'rsync to backup location',
            notes: 'Consider MinIO for S3-compatible API'
        } : null,

        search: features.includes('search') ? {
            type: 'Database Native',
            recommendation: database === 'document' 
                ? 'MongoDB text indexes'
                : 'PostgreSQL Full-text Search',
            notes: 'No need for dedicated search at this scale'
        } : null,

        auth: features.includes('auth') ? {
            type: 'JWT + bcrypt',
            recommendation: 'Custom implementation',
            sessions: 'Redis-backed sessions',
            mfa: 'Optional'
        } : null,

        realtime: features.includes('websocket') || app_type === 'realtime' ? {
            type: 'Socket.io',
            recommendation: 'Built into Node.js server',
            scaling: availConfig.appReplicas > 1 ? 'Redis adapter for multi-instance' : 'Single server - no adapter needed'
        } : null,

        availability: {
            level: availability,
            sla: availability === 'standard' ? '99%' : availability === 'high' ? '99.9%' : '99.99%',
            healthCheck: {
                enabled: true,
                interval: `${availConfig.healthCheckInterval}s`,
                path: '/health'
            },
            restartPolicy: availConfig.restartPolicy,
            failover: availConfig.failoverTime ? {
                enabled: true,
                detectionTime: `${availConfig.failoverTime}s`
            } : { enabled: false }
        },

        deployment: {
            platform: 'Docker Compose on single server',
            ci_cd: team_size === 'solo' ? 'Simple SSH deploy' : 'GitHub Actions with SSH deploy',
            strategy: 'docker-compose pull && docker-compose up -d',
            monitoring: availability === 'standard' ? 'Basic health checks' : 'Health checks with alerting'
        },

        infrastructure: {
            webServer: 'Nginx (reverse proxy)',
            ssl: "Let's Encrypt with certbot",
            dns: 'Any DNS provider (Cloudflare free works)',
            docker: 'Docker Compose for all services'
        },

        monitoring: {
            logs: 'Docker logs + file logging',
            metrics: budget === 'minimal' ? 'Optional' : 'Prometheus + Grafana in Docker',
            alerts: availability === 'standard' 
                ? 'Simple cron-based health check script'
                : 'Prometheus alerting to Slack/Email',
            uptime: 'curl-based health endpoint monitoring'
        },

        estimatedCost: getEstimatedCost(resource_tier, config.managed_level),

        serverRequirements: {
            selected: {
                cpu: `${tierSpecs.cpu} vCPU`,
                ram: `${tierSpecs.memory / 1024}GB`,
                storage: `${tierSpecs.storage}GB SSD`,
                bandwidth: 'Unlimited'
            }
        }
    };

    return architecture;
}

function getEstimatedCost(resourceTier, managedLevel) {
    const tierCosts = {
        starter: { min: 20, max: 50 },      // Starter Plan
        standard: { min: 100, max: 200 }    // Production Plan
    };

    const managedMultiplier = {
        templates_only: 1,
        semi_managed: 1.3,
        full_managed: 1.5
    };

    const baseCost = tierCosts[resourceTier] || tierCosts.starter;
    const multiplier = managedMultiplier[managedLevel] || 1;

    return {
        range: `$${Math.round(baseCost.min * multiplier)}-${Math.round(baseCost.max * multiplier)}/month`,
        breakdown: {
            infrastructure: `$${baseCost.min}-${baseCost.max}`,
            management: managedLevel !== 'templates_only' 
                ? `+${Math.round((multiplier - 1) * 100)}% for ${managedLevel.replace('_', ' ')}`
                : 'Self-managed'
        },
        notes: resourceTier === 'starter' 
            ? 'Starter Plan - Best for MVPs and prototypes'
            : 'Production Plan - Best for production apps'
    };
}

module.exports = { getSmallArchitecture };

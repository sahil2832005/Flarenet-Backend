const { RESOURCE_TIERS, AVAILABILITY_CONFIG } = require('../resourceCalculator');

function getMediumArchitecture(config) {
    const { app_type, database, features, traffic, budget, resource_tier, availability, team_size } = config;

    const tierSpecs = RESOURCE_TIERS[resource_tier] || RESOURCE_TIERS.standard;
    const availConfig = AVAILABILITY_CONFIG[availability] || AVAILABILITY_CONFIG.standard;

    const architecture = {
        name: traffic === 'spiky' ? 'Scalable Monolith with Auto-Scaling' : 'Modular Monolith',
        tier: 'medium',
        resourceTier: resource_tier,

        backend: {
            framework: app_type === 'realtime' 
                ? 'Node.js + Socket.io with Redis Adapter'
                : 'Node.js + Express/Fastify',
            structure: app_type === 'microservices' 
                ? 'Service-oriented (2-3 services)'
                : 'Modular Monolith',
            api: 'REST API with OpenAPI spec',
            replicas: Math.min(availConfig.appReplicas, tierSpecs.maxReplicas),
            notes: team_size === 'small' 
                ? 'Modular structure allows easy team scaling'
                : 'Consider splitting into services if complexity grows'
        },

        database: {
            primary: database === 'document' 
                ? { 
                    type: 'MongoDB', 
                    recommendation: 'Self-hosted MongoDB Replica Set',
                    replication: availConfig.dbReplicas > 0 
                        ? `Replica Set (${1 + availConfig.dbReplicas} nodes)`
                        : 'Single node with backup'
                  }
                : { 
                    type: 'PostgreSQL', 
                    recommendation: 'Self-hosted with streaming replication',
                    replication: availConfig.dbReplicas > 0
                        ? `Primary + ${availConfig.dbReplicas} read replica(s)`
                        : 'Primary with point-in-time recovery'
                  },
            orm: database === 'document' ? 'Mongoose' : 'Prisma',
            backup: 'Automated daily backups with pg_dump/mongodump + offsite copy',
            connectionPooling: database === 'document' ? 'Mongoose pooling' : 'PgBouncer',
            replicas: availConfig.dbReplicas
        },

        cache: {
            type: 'Redis Sentinel',
            recommendation: 'Redis Sentinel setup (3 nodes for HA)',
            use: [
                'Session storage',
                'API response caching',
                'Rate limiting',
                features.includes('queue') ? 'Job queues (BullMQ)' : null
            ].filter(Boolean),
            sizing: '4-8GB'
        },

        queue: features.includes('queue') ? {
            type: 'BullMQ + Redis',
            recommendation: 'Dedicated Redis instance for queues',
            workers: 'Dedicated worker containers (2-4)',
            use: 'Emails, notifications, heavy processing'
        } : null,

        storage: features.includes('files') ? {
            type: 'NFS/Network Storage',
            recommendation: 'Dedicated storage server with NFS',
            notes: 'Consider MinIO for S3-compatible object storage',
            backup: 'rsync to backup server'
        } : null,

        search: features.includes('search') ? {
            type: 'Database Native',
            recommendation: database === 'document' 
                ? 'MongoDB text indexes' 
                : 'PostgreSQL full-text search with GIN indexes',
            notes: 'Use dedicated read replica for search queries'
        } : null,

        auth: features.includes('auth') ? {
            type: 'JWT with refresh tokens',
            recommendation: 'Custom auth + Redis session store',
            oauth: 'OAuth2 providers (Google, GitHub)',
            security: 'Rate limiting, account lockout, bcrypt/argon2',
            mfa: 'Optional'
        } : null,

        realtime: features.includes('websocket') || app_type === 'realtime' ? {
            type: 'Socket.io with Redis Adapter',
            recommendation: availConfig.appReplicas > 1 
                ? 'Sticky sessions + Redis Adapter'
                : 'Nginx ip_hash for sticky sessions',
            scaling: 'Redis Adapter for cross-server pub/sub',
            notes: 'Configure Nginx for WebSocket upgrade'
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
                detectionTime: `${availConfig.failoverTime}s`,
                automatic: true
            } : { enabled: false }
        },

        deployment: {
            platform: 'Docker Compose on bare metal servers',
            ci_cd: 'GitHub Actions with SSH deploy',
            strategy: 'Rolling deployment with health checks',
            environments: ['development', 'staging', 'production']
        },

        infrastructure: {
            webServer: 'Nginx as reverse proxy and load balancer',
            ssl: "Let's Encrypt with certbot auto-renewal",
            dns: 'Self-managed or Cloudflare (DNS only)',
            secrets: 'Environment files with restricted permissions',
            networking: 'Private network between servers'
        },

        monitoring: {
            logs: 'Centralized logging with rsyslog or Loki',
            metrics: 'Prometheus + Grafana (self-hosted)',
            healthChecks: 'Custom health endpoints + uptime monitor',
            alerts: 'Grafana alerting to Slack/Email'
        },

        security: {
            firewall: 'iptables/ufw with strict ingress rules',
            fail2ban: 'Fail2ban for SSH and application protection',
            scanning: 'npm audit, Snyk CLI',
            secrets: 'Environment variables, no secrets in code'
        },

        estimatedCost: getMediumEstimatedCost(resource_tier, config.managed_level),

        serverRequirements: {
            selected: {
                tier: tierSpecs.name,
                cpu: `${tierSpecs.cpu} vCPU`,
                ram: `${tierSpecs.memory / 1024}GB`,
                storage: `${tierSpecs.storage}GB SSD`
            },
            replicas: {
                app: availConfig.appReplicas,
                database: 1 + availConfig.dbReplicas,
                cache: availConfig.redisReplicas > 0 ? 3 : 1
            }
        }
    };

    return architecture;
}

function getMediumEstimatedCost(resourceTier, managedLevel) {
    const tierCosts = {
        starter: { min: 50, max: 100 },     // Starter Plan (limited for medium scale)
        standard: { min: 130, max: 300 }    // Production Plan
    };

    const managedMultiplier = {
        templates_only: 1,
        semi_managed: 1.3,
        full_managed: 1.5
    };

    const baseCost = tierCosts[resourceTier] || tierCosts.standard;
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
            ? 'Starter Plan - May be limited for medium scale, consider upgrading'
            : 'Production Plan with multi-server setup'
    };
}

module.exports = { getMediumArchitecture };

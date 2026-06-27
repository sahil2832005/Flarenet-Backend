/**
 * Large Scale Architecture Template
 * For: 100,000+ users, enterprise scale
 * Self-hosted with: Nginx, Redis, MongoDB/PostgreSQL, Docker, Server
 * Phase 2: Now uses resource_tier, availability, compliance inputs
 * 
 * NOTE: Only Starter and Standard tiers available.
 * Large scale should use Standard tier with appropriate warnings.
 */

const { RESOURCE_TIERS, AVAILABILITY_CONFIG } = require('../resourceCalculator');

function getLargeArchitecture(config) {
    const { app_type, database, features, traffic, resource_tier, availability, team_size, compliance } = config;
    
    // Phase 2: Get actual resource tier specs (fallback to standard)
    const tierSpecs = RESOURCE_TIERS[resource_tier] || RESOURCE_TIERS.standard;
    const availConfig = AVAILABILITY_CONFIG[availability] || AVAILABILITY_CONFIG.high;

    const architecture = {
        name: team_size === 'large' ? 'Enterprise Microservices Platform' : 'Distributed Microservices',
        tier: 'large',
        resourceTier: resource_tier,
        
        // NOTE: compute section removed - tier specs shown in Resources tab

        backend: {
            framework: 'Node.js microservices',
            structure: 'Microservices Architecture',
            // Phase 2: Replicas based on availability
            replicas: Math.min(availConfig.appReplicas, tierSpecs.maxReplicas),
            services: [
                'API Gateway (Node.js)',
                'Auth Service (Node.js)',
                'User Service (Node.js)',
                'Core Business Service(s) (Node.js)',
                features.includes('queue') ? 'Worker Service (Node.js)' : null,
                features.includes('websocket') ? 'Realtime Service (Node.js + Socket.io)' : null
            ].filter(Boolean),
            communication: {
                sync: 'REST API between services',
                async: 'Redis Pub/Sub for events'
            },
            patterns: ['Circuit Breaker', 'Retry logic', 'Health checks', 'Service mesh']
        },

        database: {
            primary: database === 'document' || database === 'both'
                ? { 
                    type: 'MongoDB', 
                    setup: 'Sharded Cluster',
                    sharding: `${2 + availConfig.dbReplicas}+ shards with replica sets`,
                    replication: 'Replica set per shard'
                  }
                : { 
                    type: 'PostgreSQL', 
                    setup: 'Primary + Multiple Read Replicas',
                    replication: 'Streaming replication',
                    partitioning: 'Table partitioning for large tables',
                    replicas: availConfig.dbReplicas
                  },
            perService: 'Dedicated database per service if needed',
            // Phase 2: Backup based on compliance
            backup: compliance.includes('hipaa')
                ? 'Continuous backup with 6-year retention, encrypted (HIPAA)'
                : compliance.includes('pci')
                    ? 'Point-in-time recovery, encrypted, quarterly testing (PCI)'
                    : 'Continuous backup with point-in-time recovery',
            backup: 'Continuous backup with point-in-time recovery',
            connectionPooling: database === 'document' ? 'Mongoose pooling' : 'PgBouncer cluster'
        },

        cache: {
            type: 'Redis Cluster',
            setup: 'Redis Cluster (6+ nodes)',
            layers: [
                { name: 'L1', type: 'In-process cache (per container)', ttl: '1 min' },
                { name: 'L2', type: 'Redis Cluster (shared)', ttl: '5-15 min' }
            ],
            sizing: '32-64GB total cluster',
            use: ['Session', 'API cache', 'Rate limiting', 'Service communication']
        },

        queue: {
            type: 'BullMQ + Redis',
            setup: 'Dedicated Redis Cluster for queues',
            use: [
                'Background jobs',
                'Service communication',
                'Email/notification processing',
                'Data processing pipelines'
            ],
            workers: 'Dedicated worker service containers'
        },

        storage: features.includes('files') ? {
            type: 'Distributed Storage',
            setup: 'Dedicated storage servers with replication',
            notes: 'Consider GlusterFS or similar for distributed storage'
        } : null,

        search: features.includes('search') ? {
            type: 'Database Native (Optimized)',
            setup: database === 'document' 
                ? 'MongoDB dedicated search indexes' 
                : 'PostgreSQL with optimized GIN/GiST indexes',
            notes: 'Dedicated read replicas for search queries'
        } : null,

        auth: {
            type: 'Dedicated Auth Service',
            setup: 'Separate Node.js auth microservice',
            features: [
                'JWT with short expiry',
                'Refresh token rotation',
                'Rate limiting per user',
                'Account lockout',
                // Phase 2: MFA based on compliance
                compliance.includes('hipaa') || compliance.includes('pci') ? 'MFA required' : 'MFA optional'
            ],
            sessions: 'Redis Cluster backed',
            // Phase 2: Compliance-specific auth requirements
            compliance: compliance.includes('hipaa') ? {
                sessionTimeout: '15 minutes',
                autoLogout: true,
                accessLogging: 'All PHI access logged'
            } : compliance.includes('pci') ? {
                sessionTimeout: '15 minutes',
                uniqueIds: 'Required per user',
                accessReview: 'Quarterly'  
            } : null
        },

        realtime: features.includes('websocket') || app_type === 'realtime' ? {
            type: 'Dedicated Realtime Service',
            setup: 'Node.js + Socket.io with Redis Cluster Adapter',
            scaling: `${availConfig.appReplicas}+ dedicated instances for WebSocket`,
            stickySession: 'Nginx ip_hash for connection persistence',
            notes: 'Design for 100k+ concurrent connections'
        } : null,

        // Phase 2: Availability configuration
        availability: {
            level: availability,
            sla: availability === 'standard' ? '99%' : availability === 'high' ? '99.9%' : '99.99%',
            healthCheck: {
                enabled: true,
                interval: `${availConfig.healthCheckInterval}s`,
                path: '/health',
                deepCheck: '/health/deep'
            },
            restartPolicy: availConfig.restartPolicy,
            failover: {
                enabled: true,
                detectionTime: `${availConfig.failoverTime || 30}s`,
                automatic: true,
                multiNode: availability === 'critical'
            }
        },

        apiGateway: {
            type: 'Nginx API Gateway',
            setup: 'Nginx with custom configuration',
            features: [
                'Rate limiting',
                'Request routing',
                'Load balancing',
                'SSL termination',
                'Request logging'
            ]
        },

        deployment: {
            method: 'Docker Compose or Docker Swarm',
            ci_cd: 'GitHub Actions with automated testing',
            strategy: 'Rolling deployment with health checks',
            environments: ['development', 'staging', 'production'],
            blueGreen: 'Optional blue-green deployment setup'
        },

        infrastructure: {
            webServer: 'Nginx cluster (active-passive or active-active)',
            ssl: 'Let\'s Encrypt with centralized cert management',
            containers: 'Docker on each server',
            networking: 'Private network with firewall rules',
            dns: 'Internal DNS for service discovery'
        },

        monitoring: {
            logs: {
                collection: 'Centralized logging (rsyslog/filebeat)',
                storage: 'Log server with rotation'
            },
            metrics: {
                collection: 'Prometheus (self-hosted)',
                visualization: 'Grafana dashboards'
            },
            healthChecks: 'Custom health endpoints per service',
            alerts: 'Grafana alerting or custom alert scripts'
        },

        security: {
            firewall: 'iptables/ufw with strict rules',
            networkIsolation: 'Private network for all internal services',
            secrets: 'Environment variables with restricted file permissions',
            encryption: 'TLS for all internal communication'
        },

        highAvailability: {
            strategy: 'No single point of failure',
            database: `${1 + availConfig.dbReplicas} node replica set with automatic failover`,
            cache: availConfig.redisReplicas > 0 ? 'Redis Cluster with automatic failover' : 'Redis with persistence',
            loadBalancer: availability === 'critical' ? 'Multiple Nginx instances (active-active)' : 'Multiple Nginx instances',
            backup: compliance.includes('hipaa') 
                ? 'Encrypted automated backups with offsite storage (6-year retention)'
                : 'Regular automated backups with offsite storage'
        },

        // Phase 2: Cost based on resource tier
        estimatedCost: getLargeEstimatedCost(resource_tier, config.managed_level),

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
                cache: availConfig.redisReplicas > 0 ? 6 : 3,
                loadBalancer: availability === 'critical' ? 3 : 2
            }
        }
    };

    return architecture;
}

/**
 * Phase 2: Calculate estimated cost based on tier and managed level
 * Only Starter and Standard tiers available
 * Large scale with Standard tier may need multiple server instances
 */
function getLargeEstimatedCost(resourceTier, managedLevel) {
    const tierCosts = {
        starter: { min: 100, max: 200 },     // Not recommended for large scale
        standard: { min: 200, max: 400 }     // Production Plan - may need multiple instances
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
            ? 'Warning: Starter Plan not recommended for large scale. Upgrade to Standard.'
            : 'Production Plan - Consider multiple server instances for large scale'
    };
}

module.exports = { getLargeArchitecture };

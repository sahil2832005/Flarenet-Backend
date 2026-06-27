/**
 * Response Formatter
 * Converts architecture data into UI-friendly format
 * Phase 2: Added resource allocation, compliance, availability sections
 */

/**
 * Format full architecture for detailed view
 */
function formatFullResponse(architecture) {
    return {
        summary: {
            name: architecture.name,
            tier: architecture.tier,
            resourceTier: architecture.resourceTier,
            description: getTierDescription(architecture.tier)
        },
        
        diagram: generateTextDiagram(architecture),
        
        // Phase 2: Resource allocation section
        resourceAllocation: architecture.resourceAllocation ? {
            title: 'Resource Allocation',
            tier: architecture.resourceAllocation.tier,
            containers: architecture.resourceAllocation.containers,
            summary: architecture.resourceAllocation.summary
        } : null,
        
        // Phase 2: Availability section
        availability: architecture.availabilityConfig ? {
            title: 'High Availability',
            level: architecture.availabilityConfig.level,
            sla: architecture.availabilityConfig.sla,
            replicas: {
                app: architecture.availabilityConfig.appReplicas,
                database: architecture.availabilityConfig.dbReplicas
            },
            healthCheck: architecture.availabilityConfig.healthCheck,
            failover: architecture.availabilityConfig.failover
        } : null,
        
        // Phase 2: Compliance section  
        compliance: architecture.compliance?.enabled ? {
            title: 'Compliance Configuration',
            standards: architecture.compliance.standards,
            requirements: architecture.compliance.requirements,
            checklist: architecture.compliance.checklist
        } : null,
        
        // Phase 2: Network section
        network: architecture.networkConfig ? {
            title: 'Network Configuration',
            type: architecture.networkConfig.type,
            isolation: architecture.networkConfig.isolation,
            publicAccess: architecture.networkConfig.publicAccess,
            firewall: architecture.networkConfig.firewall
        } : null,
        
        components: formatComponents(architecture),
        
        deployment: architecture.deployment ? {
            title: 'Deployment',
            platform: architecture.deployment.platform,
            ciCd: architecture.deployment.ci_cd,
            strategy: architecture.deployment.strategy,
            environments: architecture.deployment.environments
        } : null,

        cost: architecture.estimatedCost ? {
            title: 'Estimated Cost',
            range: architecture.estimatedCost.range,
            breakdown: architecture.estimatedCost.breakdown,
            notes: architecture.estimatedCost.notes
        } : null,

        // Phase 2: Enhanced warnings with severity
        warnings: (architecture.warnings || []).map(w => ({
            type: w.type,
            severity: w.severity || 'warning',
            message: w.message,
            recommendation: w.recommendation
        })),

        recommendations: (architecture.recommendations || []).map(r => ({
            type: r.type,
            message: r.message
        })),

        nextSteps: generateNextSteps(architecture),

        metadata: {
            generatedAt: architecture.generatedAt,
            basedOn: architecture.inputConfig
        }
    };
}

/**
 * Format for chat message (shorter)
 * Phase 2: Added resource allocation, availability, compliance
 */
function formatChatResponse(architecture) {
    const summary = [];
    
    summary.push(`### ${architecture.name}`);
    summary.push(`*${getTierDescription(architecture.tier)}*\n`);
    
    // Phase 2: Resource tier info
    if (architecture.resourceTier) {
        summary.push(`**Resource Tier:** ${architecture.resourceTier.charAt(0).toUpperCase() + architecture.resourceTier.slice(1)}`);
    }
    
    summary.push('\n**Tech Stack:**');
    
    // NOTE: compute removed - shown in Resources tab
    if (architecture.backend) {
        const replicas = architecture.backend.replicas ? ` × ${architecture.backend.replicas} replicas` : '';
        summary.push(`- **Backend:** ${architecture.backend.framework} - ${architecture.backend.structure}${replicas}`);
    }
    if (architecture.database?.primary) {
        const dbReplicas = architecture.database.replicas ? ` + ${architecture.database.replicas} replica(s)` : '';
        summary.push(`- **Database:** ${architecture.database.primary.type}${dbReplicas}`);
    }
    if (architecture.cache) {
        summary.push(`- **Cache:** ${architecture.cache.type}`);
    }
    if (architecture.queue) {
        summary.push(`- **Queue:** ${architecture.queue.type}`);
    }
    
    // Phase 2: Availability info
    if (architecture.availability || architecture.availabilityConfig) {
        const avail = architecture.availability || architecture.availabilityConfig;
        summary.push(`\n**Availability:** ${avail.sla || avail.level} SLA`);
    }
    
    // Phase 2: Compliance info
    if (architecture.compliance?.enabled && architecture.compliance.standards?.length > 0) {
        const standards = architecture.compliance.standards.map(s => s.name).join(', ');
        summary.push(`**Compliance:** ${standards}`);
    }
    
    summary.push(`\n**Estimated Cost:** ${architecture.estimatedCost?.range || 'Variable'}`);

    // Phase 2: Enhanced warnings with severity
    if (architecture.warnings?.length > 0) {
        const criticalWarnings = architecture.warnings.filter(w => w.severity === 'critical');
        const otherWarnings = architecture.warnings.filter(w => w.severity !== 'critical');
        
        if (criticalWarnings.length > 0) {
            summary.push('\n**⚠️ Critical Issues:**');
            criticalWarnings.forEach(w => {
                summary.push(`- ${w.message}`);
                if (w.recommendation) {
                    summary.push(`  → ${w.recommendation}`);
                }
            });
        }
        
        if (otherWarnings.length > 0) {
            summary.push('\n**Considerations:**');
            otherWarnings.forEach(w => {
                summary.push(`- ${w.message}`);
            });
        }
    }

    return summary.join('\n');
}

/**
 * Format components for UI cards
 * NOTE: Compute component removed - tier info is shown in Resources tab
 * Only actual service containers are shown here
 */
function formatComponents(architecture) {
    const components = [];

    // Nginx/Load Balancer - always present for reverse proxy
    if (architecture.infrastructure?.webServer) {
        components.push({
            id: 'nginx',
            title: 'Nginx',
            type: 'Nginx',
            recommendation: 'Reverse proxy with SSL termination',
            details: [
                'SSL termination',
                'Request routing',
                'Rate limiting'
            ]
        });
    }

    if (architecture.backend) {
        components.push({
            id: 'backend',
            title: 'Backend',
            type: architecture.backend.framework,
            structure: architecture.backend.structure,
            details: [
                `API: ${architecture.backend.api}`,
                architecture.backend.notes
            ]
        });
    }

    if (architecture.database?.primary) {
        components.push({
            id: 'database',
            title: 'Database',
            type: architecture.database.primary.type,
            recommendation: architecture.database.primary.recommendation,
            details: [
                `ORM: ${architecture.database.orm}`,
                `Backup: ${architecture.database.backup}`
            ]
        });
    }

    if (architecture.cache) {
        components.push({
            id: 'cache',
            title: 'Cache',
            type: architecture.cache.type,
            recommendation: architecture.cache.recommendation,
            details: Array.isArray(architecture.cache.use) 
                ? architecture.cache.use 
                : [architecture.cache.use]
        });
    }

    if (architecture.queue) {
        components.push({
            id: 'queue',
            title: 'Queue',
            type: architecture.queue.type,
            recommendation: architecture.queue.recommendation,
            details: Array.isArray(architecture.queue.use)
                ? architecture.queue.use
                : [architecture.queue.use]
        });
    }

    if (architecture.storage) {
        components.push({
            id: 'storage',
            title: 'Storage',
            type: architecture.storage.type,
            recommendation: architecture.storage.recommendation,
            details: [`CDN: ${architecture.storage.cdn}`]
        });
    }

    if (architecture.search) {
        components.push({
            id: 'search',
            title: 'Search',
            type: architecture.search.type,
            recommendation: architecture.search.recommendation,
            details: [architecture.search.notes]
        });
    }

    if (architecture.auth) {
        components.push({
            id: 'auth',
            title: 'Authentication',
            type: architecture.auth.type,
            recommendation: architecture.auth.recommendation,
            details: Array.isArray(architecture.auth.features)
                ? architecture.auth.features.slice(0, 3)
                : [architecture.auth.sessions]
        });
    }

    if (architecture.realtime) {
        components.push({
            id: 'realtime',
            title: 'Realtime',
            type: architecture.realtime.type,
            recommendation: architecture.realtime.recommendation,
            details: [`Scaling: ${architecture.realtime.scaling}`]
        });
    }

    if (architecture.monitoring) {
        components.push({
            id: 'monitoring',
            title: 'Monitoring',
            type: 'Observability Stack',
            details: [
                `Logs: ${architecture.monitoring.logs?.collection || architecture.monitoring.logs}`,
                `Metrics: ${architecture.monitoring.metrics?.collection || architecture.monitoring.metrics}`,
                `Alerts: ${architecture.monitoring.alerts}`
            ].filter(d => d && !d.includes('undefined'))
        });
    }

    return components;
}

/**
 * Generate simple text diagram
 */
function generateTextDiagram(architecture) {
    if (architecture.tier === 'small') {
        return `
┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Nginx     │
└─────────────┘     └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Node.js   │
                    │   (Docker)  │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐
     │  Database   │ │   Redis   │ │   Storage   │
     └─────────────┘ └───────────┘ └─────────────┘
`;
    }

    if (architecture.tier === 'medium') {
        return `
┌─────────────┐                    ┌─────────────┐
│   Client    │───────────────────▶│    Nginx    │
└─────────────┘                    │ Load Balancer│
                                   └──────┬──────┘
                                          │
                      ┌───────────────────┼───────────────────┐
                      │                   │                   │
               ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
               │  Server 1   │     │  Server 2   │     │  Server N   │
               │  (Docker)   │     │  (Docker)   │     │  (Docker)   │
               └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
                      │                   │                   │
                      └───────────────────┼───────────────────┘
                                          │
       ┌──────────────────────────────────┼──────────────────────────────────┐
       │                    │             │              │                   │
┌──────▼──────┐      ┌──────▼──────┐ ┌────▼────┐  ┌──────▼──────┐    ┌───────▼───────┐
│   Primary   │      │   Replica   │ │  Redis  │  │   Storage   │    │     Queue     │
│   Database  │      │   Database  │ │ Sentinel│  │   (NFS)     │    │   (BullMQ)    │
└─────────────┘      └─────────────┘ └─────────┘  └─────────────┘    └───────────────┘
`;
    }

    return `
┌─────────────┐                                                 ┌─────────────┐
│   Client    │────────────────────────────────────────────────▶│    Nginx    │
└─────────────┘                                                 │ API Gateway │
                                                                └──────┬──────┘
                                                                       │
                    ┌──────────────────────────────────────────────────┴──────────────────────────────────────────────┐
                    │                              │                               │                              │
             ┌──────▼──────┐               ┌───────▼───────┐              ┌────────▼────────┐             ┌───────▼───────┐
             │ Auth Service│               │  User Service │              │ Business Service│             │ Worker Service│
             │  (Docker)   │               │   (Docker)    │              │    (Docker)     │             │   (Docker)    │
             └──────┬──────┘               └───────┬───────┘              └────────┬────────┘             └───────┬───────┘
                    │                              │                               │                              │
                    └──────────────────────────────┼───────────────────────────────┼──────────────────────────────┘
                                                   │                               │
                         ┌─────────────────────────┴───────────────────────────────┴─────────────────────────┐
                         │                         │                    │                                    │
                  ┌──────▼──────┐           ┌──────▼──────┐       ┌─────▼─────┐                      ┌───────▼───────┐
                  │  Database   │           │   Replica   │       │   Redis   │                      │   BullMQ      │
                  │  (Primary)  │           │   (Multi)   │       │  Cluster  │                      │   Queues      │
                  └─────────────┘           └─────────────┘       └───────────┘                      └───────────────┘
`;
}

/**
 * Get tier description
 */
function getTierDescription(tier) {
    const descriptions = {
        small: 'Simple self-hosted architecture perfect for MVPs and small applications. Single server setup.',
        medium: 'Scalable self-hosted architecture with load balancing, replication, and high availability.',
        large: 'Distributed self-hosted microservices architecture for enterprise scale with full redundancy.'
    };
    return descriptions[tier] || descriptions.small;
}

/**
 * Get warning type label
 */
function getWarningLabel(type) {
    const labels = {
        consideration: 'Consideration',
        complexity: 'Complexity',
        budget: 'Budget',
        scaling: 'Scaling'
    };
    return labels[type] || 'Warning';
}

/**
 * Generate next steps
 */
function generateNextSteps(architecture) {
    const steps = [];

    steps.push({
        order: 1,
        title: 'Set Up Development Environment',
        description: `Install ${architecture.backend?.framework || 'Node.js'} and Docker`
    });

    steps.push({
        order: 2,
        title: 'Initialize Project',
        description: 'Create project structure with your chosen framework'
    });

    if (architecture.database) {
        steps.push({
            order: 3,
            title: 'Set Up Database',
            description: `Configure ${architecture.database.primary?.type || 'database'} with ${architecture.database.orm || 'ORM'}`
        });
    }

    steps.push({
        order: 4,
        title: 'Configure Deployment',
        description: `Set up ${architecture.deployment?.ci_cd || 'CI/CD'} pipeline`
    });

    steps.push({
        order: 5,
        title: 'Add Monitoring',
        description: 'Implement basic health checks and logging'
    });

    return steps;
}

module.exports = {
    formatFullResponse,
    formatChatResponse,
    formatComponents,
    generateTextDiagram,
    generateNextSteps
};

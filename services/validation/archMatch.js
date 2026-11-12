'use strict';

/**
 * checkArchMatch compares the manifest produced by the Go validator
 * against the project's architecture answers to detect misalignments.
 *
 * Returns a lightweight summary the frontend can show to the user:
 *   { aligned: boolean, warnings: string[], suggestions: string[] }
 */
function checkArchMatch(manifest, arch) {
    const warnings = [];
    const suggestions = [];

    const deps = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
    const features = Array.isArray(arch.features) ? arch.features : [];

    // ── Database alignment ───────────────────────────────────────────────────

    if (arch.database === 'relational') {
        const hasRelational = deps.some(d =>
            ['pg', 'mysql2', 'mysql', 'sequelize', 'prisma', 'knex', 'typeorm', 'drizzle-orm'].includes(d)
        );
        if (!hasRelational) {
            warnings.push('Arch recommends a relational database but no relational DB client was found in dependencies.');
            suggestions.push('Add prisma, pg, or sequelize to your package.json.');
        }
    }

    if (arch.database === 'document') {
        const hasDocument = deps.some(d =>
            ['mongoose', 'mongodb', 'dynamoose'].includes(d)
        );
        if (!hasDocument) {
            warnings.push('Arch recommends a document database but no document DB client was found in dependencies.');
            suggestions.push('Add mongoose or mongodb to your package.json.');
        }
    }

    // ── Auth alignment ───────────────────────────────────────────────────────

    if (features.includes('auth')) {
        const hasAuth = deps.some(d =>
            ['passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'next-auth', 'better-auth',
             'auth0', 'firebase-admin', '@clerk/clerk-sdk-node'].includes(d)
        );
        if (!hasAuth) {
            warnings.push('Arch includes auth but no auth library was found in dependencies.');
            suggestions.push('Add jsonwebtoken + bcryptjs, or passport to your project.');
        }
    }

    // ── Cache alignment ──────────────────────────────────────────────────────

    if (features.includes('cache')) {
        const hasCache = deps.some(d =>
            ['ioredis', 'redis', 'node-cache', 'lru-cache', 'memcached'].includes(d)
        );
        if (!hasCache) {
            warnings.push('Arch includes caching but no cache client was found in dependencies.');
            suggestions.push('Add ioredis or node-cache to your project.');
        }
    }

    // ── Queue alignment ──────────────────────────────────────────────────────

    if (features.includes('queue')) {
        const hasQueue = deps.some(d =>
            ['bull', 'bullmq', 'bee-queue', 'agenda', 'kue', 'rabbitmq', 'amqplib'].includes(d)
        );
        if (!hasQueue) {
            warnings.push('Arch includes a queue but no queue library was found in dependencies.');
            suggestions.push('Add bullmq or bee-queue to your project.');
        }
    }

    // ── Scale / framework alignment ──────────────────────────────────────────

    if (arch.scale === 'large' || arch.traffic === 'spiky') {
        const hasCluster = deps.some(d => ['cluster', 'pm2', 'throng'].includes(d));
        if (!hasCluster) {
            suggestions.push('For large scale or spiky traffic, consider pm2 or Node.js cluster mode for multi-process handling.');
        }
    }

    // ── Node.js version alignment ────────────────────────────────────────────

    if (manifest.nodeVersion) {
        const major = parseInt(manifest.nodeVersion.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(major) && major < 18) {
            warnings.push(`Node.js ${manifest.nodeVersion} is below the minimum recommended version (18 LTS).`);
            suggestions.push('Upgrade to Node.js 20 LTS for better performance and security support.');
        }
    }

    return {
        aligned: warnings.length === 0,
        warnings,
        suggestions
    };
}

module.exports = { checkArchMatch };

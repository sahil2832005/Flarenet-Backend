const { Worker } = require('bullmq');
const { prisma } = require('../clients/prismaClient');
const buildQueue = require('../queues/buildQueue');
require('dotenv').config({ path: '../.env' });
const failedQueueWorker = new Worker('failedBuildQueue', async (job) => {
    const { deploymentId, projectId, gitUrl, error } = job.data;

    let action = 'DISCARD';
    if (error.includes('network')) {
        action = 'RETRY';
    }
    else if (error.includes('validation')) {
        action = 'ESCALATE';
    }

    switch (action) {
        case 'DISCARD':
            await prisma.failedJobs.update({
                where: { jobId: job.id },
                data: { status: 'DISCARDED' },
            });
            break;
        case 'RETRY':
            await buildQueue.add('retryJob', job.data);
            break;
        case 'ESCALATE':
            await prisma.failedJobs.update({
                where: { jobId: job.id },
                data: { status: 'ESCALATED' },
            });
            break;
        default:
            break;
    }

}, {
    connection: {
        url: process.env.REDIS_URL, // Use REDIS_URL from environment
    },
});

failedQueueWorker.on('ready', () => {});

failedQueueWorker.on('failed', (job, err) => {
    console.error(`Failed to process job in DLQ: ${job.id}, Error: ${err.message}`);
});

module.exports = failedQueueWorker;

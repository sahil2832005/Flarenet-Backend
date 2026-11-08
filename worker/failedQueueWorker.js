//need to done dev sied working as havent checked
const { Worker } = require('bullmq');
const { prisma } = require('../clients/prismaClient');
const buildQueue = require('../queues/buildQueue');
require('dotenv').config({ path: '../.env' });
const failedQueueWorker = new Worker('failedBuildQueue', async (job) => {
    const { deploymentId, projectId, gitUrl, error } = job.data;

    // console.log(`processing failed jobbs in hthe form of dead letter queue for deployment id ${deploymetId}`);

    //categorize the failure
    let action = 'DISCARD';
    if (error.includes('network')) {
        action = 'RETRY';
    }
    else if (error.includes('validation')) {
        action = 'ESCALATE';
    }

    //CASES FOR PERFORMING NECESSARY ACTIONS
    switch (action) {
        case 'DISCARD':
            // console.log(`Discarding failed job for Deployment ID: ${deploymentId}`);
            await prisma.failedJobs.update({
                where: { jobId: job.id },
                data: { status: 'DISCARDED' },
            });
            break;
        case 'RETRY':
            // console.log(`Retrying failed job for Deployment ID: ${deploymentId}`);
            //add the job back to the build queue fir retry purpose
            await buildQueue.add('retryJob', job.data);
            break;
        case 'ESCALATE':
            // console.log(`Escalating failed job for Deployment ID: ${deploymentId}`);
            await prisma.failedJobs.update({
                where: { jobId: job.id },
                data: { status: 'ESCALATED' },
            });
            break;
        default:
            // console.log(`Unknown action for failed job for Deployment ID: ${deploymentId}`);
    }
    //optinal notify teams or other services if necessary
    // console.log(`Failed job logged for Deployment ID: ${deploymentId}`);

}, {
    connection: {
        url: process.env.REDIS_URL, // Use REDIS_URL from environment
    },
});

failedQueueWorker.on('ready', () => {
    // console.log('Failed queue worker is ready to process jobs.');
});

failedQueueWorker.on('failed', (job, err) => {
    console.error(`Failed to process job in DLQ: ${job.id}, Error: ${err.message}`);
});

module.exports = failedQueueWorker;

const { Worker } = require('bullmq');
const triggerBuild = require('../tasks/triggerBuild');
require('dotenv').config({ path: '../.env' });

const taskHandelers = {
    triggerBuild,
}

const webHookTaskBuilder = new Worker('webHookQueue', async (job) => {
    const { deploymentId, projectId, workflow, gitUrl } = job.data;

    const context = {
        deploymentId,
        projectId,
        gitUrl
    }

    try {
        for (const taskName of workflow) {
            console.log(`processing task: ${taskName}`);

            const taskHandler = taskHandelers[taskName];
            if (!taskHandler) {
                console.error(`No handler found for task: ${taskName}`);
                throw new Error(`Task "${taskName}" does not have a handler`);
            }
            await taskHandler(context);

        }
    }
    catch (err) {
        console.error(`Error in processing build job for deploymentId ${deploymentId}: ${err.message}`);
        throw err; // Re-throw the error to mark the job as failed
    }
}, {
    connection: {
        url: process.env.REDIS_URL, // Use REDIS_URL from environment
    }
});

webHookTaskBuilder.on('completed', (job) => {});

webHookTaskBuilder.on('failed', (job, err) => {
    console.error(`Build job ${job.id} failed with error: ${err.message}`);
});

webHookTaskBuilder.on('ready', () => {});
module.exports = webHookTaskBuilder;

const { Worker } = require('bullmq');
const triggerBuild = require('../tasks/triggerBuild');
require('dotenv').config({ path: '../.env' });

//task handeler mapping
const taskHandelers = {
    triggerBuild,
}

const webHookTaskBuilder = new Worker('webHookQueue', async (job) => {
    //necessary data for build deployment must coome
    const { deploymentId, projectId, workflow, gitUrl } = job.data;

    //make context to pass tashHandlere
    const context = {
        deploymentId,
        projectId,
        gitUrl
    }

    //debugs logs
    // console.log('arrived context', context);
    try {
        // Process build (you can add logic to actually build the project)
        // console.log(`Building project for ${gitUrl}`);

        //try to iterate on workflow steps and process appropriate tasks attached with it
        // console.log('workflow steps:', workflow);

        for (const taskName of workflow) {
            console.log(`processing task: ${taskName}`);

            const taskHandler = taskHandelers[taskName];
            if (!taskHandler) {
                console.error(`No handler found for task: ${taskName}`);
                throw new Error(`Task "${taskName}" does not have a handler`);
            }
            console.log("task handler found for workflow");

            //execute task via providing context
            await taskHandler(context);
            console.log(`task ${taskName} completed`);

        }
        //write same code as buildqueue worker does just done queue seperations
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

// Listen for job completion or failure
webHookTaskBuilder.on('completed', (job) => {
    // console.log(`Build job ${job.id} completed successfully.`);
});

webHookTaskBuilder.on('failed', (job, err) => {
    console.error(`Build job ${job.id} failed with error: ${err.message}`);
});

webHookTaskBuilder.on('ready', () => {
    // console.log('web hook Worker is ready to process jobs.');
});
module.exports = webHookTaskBuilder;

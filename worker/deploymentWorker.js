const { Worker } = require('bullmq');
const { RunTaskCommand } = require('@aws-sdk/client-ecs');
const { client } = require('../clients/awsClient');
const { prisma } = require('../clients/prismaClient');
const failedQueue = require('../queues/failedQueue');
const { llm, memory } = require("../utils/langchainConfig"); // Import LLM instance
const kafka = require('../clients/kafkaClient');
const clickHouseClient = require('../clients/clickHouseClient');
// UUID will be dynamically imported
require('dotenv').config({ path: '../.env' });
const axios = require('axios');

const isGitHubRepoAccessible = async (gitUrl) => {
    try {
        // Extract owner and repo name from the GitHub URL
        const match = gitUrl.match(/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
        if (!match) {
            throw new Error("Invalid GitHub repository URL format.");
        }

        const [_, owner, repo] = match;
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

        // Make a request to GitHub API
        const response = await axios.get(apiUrl, {
            headers: { 'User-Agent': 'DeploymentWorker' }
        });

        return response.status === 200; // Repo exists
    } catch (error) {
        if (error.response && error.response.status === 404) {
            return false; // Repo does not exist
        }

        return false;
    }
};

//cluster/aws configs object
const config = {
    CLUSTER: process.env.FLARENET_AWS_CLUSTER_NAME || 'default-cluster',
    TASK: process.env.FLARENET_AWS_TASK_DEFINITION || 'git_project_cloner_task:18',
    MAX_RETRIES: 3,
    RETRY_DELAY: 5000,
}


const classifyLogs = async (logMessage) => {
    const prompt = `Analyze the following deployment log and categorize it accurately. Respond in EXACT format:
    "Classification: [CLASSIFICATION]
    Reasoning: [THINKING_PROCESS]"

    Possible CLASSIFICATIONS:
    - SUCCESS: The deployment, build, or upload completed successfully.
    - WARNING: Non-critical issues such as minor delays, retries, or deprecated warnings.
    - RECOVERABLE_ERROR: Errors that can be retried (e.g., network failures, temporary API errors).
    - CRITICAL_FAILURE: A major error requiring manual intervention (e.g., configuration issues, missing files).
    - BUILD_FAILURE: The build process failed due to errors in the code, dependencies, or environment.
    - UPLOAD_SUCCESS: A file upload operation was completed successfully.
    - UPLOAD_FAILURE: The upload process failed due to permission issues, file corruption, or storage errors.

    Additional Considerations:
    - If the log contains words like "retrying", "slow", or "deprecated", classify it as WARNING.
    - If the log mentions "network error", "timeout", or "connection lost", classify it as RECOVERABLE_ERROR.
    - If the log includes "build failed", "compilation error", or "dependency error", classify it as BUILD_FAILURE.
    - If the log states "upload completed" or "file uploaded", classify it as UPLOAD_SUCCESS.
    - If the log mentions "upload failed", "access denied", or "storage full", classify it as UPLOAD_FAILURE.

    Log: "${logMessage}"
    Response:`;

    try {
        const aiResponse = await llm.invoke(prompt);
        const responseText = aiResponse.content || aiResponse;

        // console.log("AI Raw Response:", responseText); // Debugging

        // More flexible regex to capture newlines and unexpected spacing
        const result = responseText.match(
            /Classification:\s*([\w_]+)[\s\S]*?Reasoning:\s*([\s\S]+)/i
        );

        if (!result) {
            console.warn("Regex failed to extract classification or reasoning.");
            return { classification: "ERROR", reasoning: "Could not extract reasoning from AI response." };
        }

        const classification = result[1]?.trim().toUpperCase();
        const reasoning = result[2]?.trim() || 'No reasoning provided';

        const validCategories = [
            "SUCCESS", "WARNING", "RECOVERABLE_ERROR", "CRITICAL_FAILURE",
            "BUILD_FAILURE", "UPLOAD_SUCCESS", "UPLOAD_FAILURE"
        ];

        return {
            classification: validCategories.includes(classification) ? classification : "WARNING",
            reasoning
        };

    } catch (error) {
        console.error("Log classification failed:", error);
        return { classification: "ERROR", reasoning: "Classification process encountered an error" };
    }
};


//define worker to process jobs
const deploymentWorker = new Worker('buildQueue', async (job) => {
    // Dynamically import uuid
    const { v4: uuidv4 } = await import('uuid');
    const { deploymentId, projectId, environment = "DEVELOPMENT", gitUrl, version = "v1.0.0", buildCommand, envVars } = job.data;

    // 1. Input Validation
    if (!deploymentId || !projectId || !gitUrl) {
        throw new Error('Missing required job parameters');
    }

    try {
        console.log(`Worker is Processing deployment for ${projectId} - Deployment ID: ${deploymentId}`);

        //pre deployment validation uusing llm
        const validationResponse = await llm.invoke(`Validate the following deployment request:
            Project ID: ${projectId}, Deployment ID: ${deploymentId}, Git URL: ${gitUrl}.
            
            GitHub Repository Status: ${await isGitHubRepoAccessible(gitUrl) ? 'Exists' : 'Not Found'}
            
            Respond in EXACT format:
            "Classification: [STATUS]
            Reasoning: [ANALYSIS]"
            
            Valid STATUS values:
            - OK: Repository exists and is accessible.
            - REPO_NOT_FOUND: The repository does not exist or is inaccessible.
            - ERROR: Critical issues preventing deployment.`);


        // Extract and parse the response
        // Extract and parse the response
        const validationText = validationResponse.content || validationResponse;
        const [classificationLine] = validationText.split('\n').map(line => line.trim());
        const classification = classificationLine.split(':')[1]?.trim().toUpperCase();

        // console.log("Validation Classification:", classification);

        // ❌ Stop execution if the repo is not found
        if (classification === 'REPO_NOT_FOUND') {
            console.error(`Deployment failed: Repository does not exist or is inaccessible. Skipping this task.`);
            throw new Error("Deployment aborted: Repository does not exist.");
        }

        // ❌ Stop execution if the classification is ERROR
        if (!classification || !['OK', 'WARNING'].includes(classification)) {
            const errorMessage = `Deployment validation failed (${classification}): ${validationText}`;
            console.error(errorMessage);
            throw new Error(errorMessage);
        }

        // Proceed if it's a WARNING (optional)
        if (classification === 'WARNING') {
            console.warn("Proceeding with warnings:", validationText);
        }

        //mark deployment status as active in  prisma database
        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { status: 'ACTIVE' },
        });
        // Simplified build command handling
        const finalBuildCommand = job.data.buildCommand 
            ? job.data.buildCommand 
            : "npm install && npm run build";
        
        // console.log("Using build command:", finalBuildCommand);
        // Remove the AI-based build command section and continue with task execution
        // Prepare environment variables
        const environmentVariables = [
            { name: 'GIT_URI', value: gitUrl },
            { name: 'PROJECT_ID', value: projectId },
            { name: 'DEPLOYMENT_ID', value: deploymentId },
            { name: 'BUILD_COMMAND', value: finalBuildCommand }
        ];
        
        // Add custom env vars if they exist
        if (envVars && typeof envVars === 'object') {
            Object.entries(envVars).forEach(([key, value]) => {
                environmentVariables.push({ name: key, value: String(value) });
            });
        }
        
        const command = new RunTaskCommand({
            cluster: config.CLUSTER,
            taskDefinition: config.TASK,
            launchType: 'FARGATE',
            count: 1,
            networkConfiguration: {
                awsvpcConfiguration: {
                    assignPublicIp: 'ENABLED',
                    subnets: ['subnet-0e0c97b6f83bfc538', 'subnet-08a60214836f38b79', 'subnet-0c4be927b2f4c3790'],
                    securityGroups: ['sg-0bf9e7e682e1bed1a']
                }
            },
            overrides: {
                containerOverrides: [
                    {
                        name: 'task_cloner_image',
                        environment: environmentVariables
                    }
                ]
            }
        });

        //send final command to task executor
        await client.send(command);
        //after processng container task mark deloyment as completed
        await prisma.deployment.update({
            where: { id: deploymentId },
            data: { status: 'ACTIVE' },
        });

    }
    catch (err) {
        throw err; // let worker.onError handler will handle this

    }

}, {
    connection: {
        url: process.env.REDIS_URL, // Use REDIS_URL from environment
    },
    limiter: {
        max: 10, // Max jobs per second prevent queue iverload
        duration: 1000
    }

});
deploymentWorker.on('ready', () => {
    // console.log('deployment Worker is ready to process jobs.');
});

deploymentWorker.on('completed', (job) => {
    // console.log(`Job completed: ${job.id}`);
});

deploymentWorker.on('failed', async (job, err) => {
    console.error(`Job failed: ${job.id}, Error: ${err.message}`);

    //classify error log to check its tyoe so ai will understand efforts required to solve that error
    const failureType = await classifyLogs(err.message);

    if (failureType === "RECOVERABLE_ERROR" && job.attemptsMade < config.MAX_RETRIES) {
        // console.log(`Retrying job ${job.id} due to recoverable error...`);
        await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY * (job.attemptsMade + 1)));
        await job.retry();
    }
    else {
        console.error(`Job failed: ${job.id}, Error: ${err.message}`);

        // Call processLogMessage directly with required fields
        await processLogMessage({
            topic: 'builder-logs',
            partition: 0, // Default partition
            message: {
                key: job.jobdeploymentId || 'unknown',
                value: JSON.stringify({ deploymentId: job.deploymentId, projectId: job.projectId, gitUrl: job.gitUrl, error: err }),
            },
        });

        // Update deployment status in Prisma
        if (job.data.deploymentId) {
            await prisma.deployment.update({
                where: { id: job.data.deploymentId },
                data: { status: 'FAILED' },
            });
        }
    }

    deploymentWorker.on('error', err => {
        console.error('catched to prevent queue stucks and run next working jobs:', err);
    });

    // Optionally update the deployment status
    if (job.data.deploymentId) {
        await prisma.deployment.update({
            where: { id: job.data.deploymentId },
            data: { status: 'FAILED' },
        });
    }
});

const consumer = kafka.consumer({ groupId: 'deployment-log-group' });

const processLogMessage = async ({ topic, partition, batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) => {
    if (!batch || !batch.messages) {
        console.error("Batch is undefined or has no messages.");
        return;
    }

    // console.log(`Received ${batch.messages.length} messages...`);

    for (const message of batch.messages) {
        if (!message.value) {
            console.warn("Skipping message with no value.");
            continue;
        }

        try {
            const logMessage = JSON.parse(message.value.toString());
            // console.log('lgmsg', logMessage);

            // Extract deployment details safely
            const {
                PROJECT_ID = null,
                DEPLOYMENT_ID = null,
                GIT_URI = null,
                log = null,
                timestamp = null,
                logLevel = 'info',
                fileName = null,
                fileSize = null,
                fileSizeInBytes = null,
                timeTaken = null
            } = logMessage || {};

            if (!DEPLOYMENT_ID || !PROJECT_ID) {
                console.warn("Missing DEPLOYMENT_ID or PROJECT_ID. Skipping.");
                continue;
            }

            // Analyze log through AI
            const { classification, reasoning } = await classifyLogs(logMessage.log);
            // console.log("AI REASONING...", reasoning);

            if (classification === "CRITICAL_FAILURE") {
                console.error("Critical failure detected. Marking deployment as failed.");
                await prisma.deployment.update({
                    where: { id: DEPLOYMENT_ID },
                    data: { status: 'FAILED' },
                });
            } else if (classification === "RECOVERABLE_ERROR") {
                console.warn("Recoverable error detected. Initiating retry mechanism.");
                await failedQueue.add('retryJob', {
                    deploymentId: DEPLOYMENT_ID,
                    projectId: PROJECT_ID,
                    gitUrl: GIT_URI,
                    error: reasoning,
                });
            } else if (classification === "SUCCESS") {
                await prisma.deployment.update({
                    where: { id: DEPLOYMENT_ID },
                    data: { status: 'ACTIVE' },
                });
            } else {
                console.log("Log classified as:", JSON.stringify(classification));
            }

            // console.log(`Log received: ${log} | Deployment: ${DEPLOYMENT_ID} | Project: ${PROJECT_ID}`);

            // Insert log into ClickHouse
            const logEntry = {
                event_id: uuidv4(),
                project_id: PROJECT_ID,
                deployment_id: DEPLOYMENT_ID,
                log_message: log,
                log_level: logLevel,
                file_name: fileName,
                file_size: fileSize,
                file_size_in_bytes: fileSizeInBytes,
                time_taken: timeTaken,
                git_url: GIT_URI,
                kafka_offset: message.offset,
                kafka_partition: partition
            };

            const aiEntry = {
                deployment_id: DEPLOYMENT_ID,
                log_event_id: logMessage.event_id || uuidv4(),
                classification: classification,
                reasoning: reasoning,
            };

            const { query_id: logQueryId } = await clickHouseClient.insert({
                table: 'deployment_logs',
                values: [logEntry],
                format: 'JSONEachRow',
            });

            // console.log(`Log inserted to ClickHouse with query ID:`);

            const { query_id: aiQueryId } = await clickHouseClient.insert({
                table: 'deployment_ai_analysis',
                values: [aiEntry],
                format: 'JSONEachRow',
            });

            // console.log(`AI analysis inserted into ClickHouse with query ID:`);

            resolveOffset(message.offset);
            await commitOffsetsIfNecessary(message.offset);
            await heartbeat();

        } catch (error) {
            console.error("Failed to parse log message:", error.message);
            return;
        }
    }
};

(async () => {
    await consumer.connect();
    // console.log("Receiver connected...");
    await consumer.subscribe({ topic: 'builder-logs', fromBeginning: true });
    await consumer.run({ eachBatch: processLogMessage }); // Changed to `eachBatch`
})();

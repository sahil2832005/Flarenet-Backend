const buildQueue = require('../queues/buildQueue');
module.exports = async function triggerBuild({ deploymentId, projectId, gitUrl }) {
    try {
        await buildQueue.add('deploy', { deploymentId: deploymentId, projectId: projectId, gitUrl: gitUrl });
    }
    catch (error) {
        console.error('Error triggering build:', error.message);
        throw error;
    }
}

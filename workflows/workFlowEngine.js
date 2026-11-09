const workflows = require('./workflows.json');
const webHookQueue = require('../queues/webHookQueue');
async function runWorkflow(workflowName, deploymentId, projectId, gitUrl) {
  const workflow = workflows[workflowName];

  if (!workflow) {
    throw new Error(`Workflow ${workflowName} not found`);
  }
  try {
    await webHookQueue.add(workflowName, { workflow, deploymentId, projectId, gitUrl });
  }
  catch (error) {
    console.error(`Failed to add workflow "${workflowName}" to the queue:`, error.message);
    throw error;
  }

}

module.exports = {
  runWorkflow
};
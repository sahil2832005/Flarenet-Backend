const { prisma } = require('../clients/prismaClient');
const { runWorkflow } = require('../workflows/workFlowEngine');

async function handlePushEvent(event) {
    // Extract the necessary details from the event object
    const { repository, ref, sender } = event.body; // Adjusted according to your event object
    // console.log('repository',repository,'ref',ref,'sender',sender);
    // console.log(`Push event detected`);
    // console.log("Event object:", event);

    // Extract context from the event.body
    const context = {
        gitUrl: repository.clone_url,        // Repository's clone URL
        branch: ref.split('/').pop(),         // Extract branch name from ref (e.g., refs/heads/main -> main)
        repositoryName: repository.name,     // Repository name
        senderName: sender.login,            // Sender's GitHub username
        senderAvatar: sender.avatar_url      // Sender's avatar URL (optional)
    };

    // console.log("Extracted context:", context);


    // Find the project in the database using the gitUrl
    const project = await prisma.project.findUnique({
        where: { gitUrl: context.gitUrl },
    });

    if (!project) {
        // console.log('Project not found');
        return;
    }

    // Mark deployment record in the database and trigger the workflow
    const deployment = await prisma.deployment.create({
        data: {
            projectId: project.id,
        }
    });
    // console.log('deployment entry created successfully');
    // return;  breaker flag 

    // Trigger the deployment workflow this is done via workflowEnngine
    await runWorkflow('deploymentWorkflow', deployment.id, project.id, project.gitUrl);
    // console.log(`Push event handled successfully via the following workflow steps`);

}

module.exports = { handlePushEvent };

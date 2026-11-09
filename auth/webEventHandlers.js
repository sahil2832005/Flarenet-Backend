const { prisma } = require('../clients/prismaClient');
const { runWorkflow } = require('../workflows/workFlowEngine');

async function handlePushEvent(event) {
    const { repository, ref, sender } = event.body;

    const context = {
        gitUrl: repository.clone_url,
        branch: ref.split('/').pop(),
        repositoryName: repository.name,
        senderName: sender.login,
        senderAvatar: sender.avatar_url
    };

    const project = await prisma.project.findUnique({
        where: { gitUrl: context.gitUrl },
    });

    if (!project) {
        return;
    }

    const deployment = await prisma.deployment.create({
        data: {
            projectId: project.id,
        }
    });
    await runWorkflow('deploymentWorkflow', deployment.id, project.id, project.gitUrl);

}

module.exports = { handlePushEvent };

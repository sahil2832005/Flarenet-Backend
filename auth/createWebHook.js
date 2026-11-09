const axios = require('axios');
require('dotenv').config({ path: '../.env' });
let Octokit;

async function createWebhookOcta(oauthToken, owner, repo) {
    const { Octokit: OctokitModule } = await import('@octokit/core');
    Octokit = OctokitModule;

    const octokit = new Octokit({ auth: oauthToken });
    try {
        const response = await octokit.request('POST /repos/{owner}/{repo}/hooks', {
            owner: owner,
            repo: repo,
            name: 'web',
            active: true,
            events: ['push', 'pull_request'],
            config: {
                url: process.env.WEBHOOK_URL,
                content_type: 'json',
                insecure_ssl: '0'
            },
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

    } catch (error) {
        console.error('Error creating webhook:', error);
    }
}

async function webHookOctoKitHelper(req, res) {
    const { oauthToken, owner, repo } = req.body;

    if (!oauthToken || !owner || !repo) {
        return res.status(400).json({ message: 'Missing required parameters: oauthToken, owner, or repo' });
    }
    try {
        const webhook = await createWebhookOcta(oauthToken, owner, repo);
        res.status(200).json({
            message: 'Webhook created successfully',
            webhook
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error creating webhook',
            error: error.message
        });
    }
}

module.exports = { webHookOctoKitHelper };

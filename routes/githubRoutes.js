const express = require('express');
const { webHookOctoKitHelper } = require('../auth/createWebHook');
const { verifyToken } = require('../middlewares/authMiddleware');
const { validateWebhookMiddleware } = require('../auth/validatewebhook');

const { githubRedirect,
    exchangeCodeForToken,
    saveAccessToken,githubCallback,getUserInfo,listRepositories,disconnectGithub } = require('../auth/githubAuth');
const { handlePushEvent } = require('../auth/webEventHandlers');
// const { App } = require('octokit');

const router = express.Router();

router.get('/auth-url', githubRedirect);
router.get('/callback', githubCallback);
router.post('/token', githubCallback);
// router.post('/save-token', saveAccessToken);

//get user information
router.get('/user-info', verifyToken, getUserInfo); //working tested using query param only nnot for body
router.get('/user-repos', verifyToken, listRepositories); //working tested using query param only nnot for body

//disconnect github account
router.post('/disconnect', verifyToken, disconnectGithub);

//routers for creating webhooks
router.post('/create-webhook', verifyToken, webHookOctoKitHelper);


//web hook route - validates GitHub signature (not JWT)
router.post('/webhook-notifier', validateWebhookMiddleware, handlePushEvent);
module.exports = router;
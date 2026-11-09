const express = require('express');
const { webHookOctoKitHelper } = require('../auth/createWebHook');
const { verifyToken } = require('../middlewares/authMiddleware');
const { validateWebhookMiddleware } = require('../auth/validatewebhook');

const { githubRedirect,
    exchangeCodeForToken,
    saveAccessToken,githubCallback,getUserInfo,listRepositories,disconnectGithub } = require('../auth/githubAuth');
const { handlePushEvent } = require('../auth/webEventHandlers');
const router = express.Router();

router.get('/auth-url', githubRedirect);
router.get('/callback', githubCallback);
router.post('/token', githubCallback);
router.get('/user-info', verifyToken, getUserInfo);
router.get('/user-repos', verifyToken, listRepositories);

router.post('/disconnect', verifyToken, disconnectGithub);
router.post('/create-webhook', verifyToken, webHookOctoKitHelper);


//web hook route - validates GitHub signature (not JWT)
router.post('/webhook-notifier', validateWebhookMiddleware, handlePushEvent);
module.exports = router;
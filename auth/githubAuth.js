const axios = require('axios');
const { prisma } = require('../clients/prismaClient');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { extractToken } = require('../middlewares/authMiddleware');

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function assertGitHubOAuthConfigured() {
    const missing = [];
    if (!CLIENT_ID) missing.push('GITHUB_CLIENT_ID');
    if (!CLIENT_SECRET) missing.push('GITHUB_CLIENT_SECRET');
    if (!REDIRECT_URI) missing.push('GITHUB_REDIRECT_URI');
    if (missing.length > 0) {
        const err = new Error(
            `GitHub OAuth is not configured. Set ${missing.join(', ')} in .env and recreate the backend container.`
        );
        err.code = 'GITHUB_OAUTH_NOT_CONFIGURED';
        throw err;
    }
}

// 1. Redirect user to GitHub authentication
// forceLogin: true = show GitHub login screen (for switching accounts)
// forceLogin: false/undefined = use existing GitHub session (default, recommended)
function getGitHubAuthUrl(forceLogin = false) {
    assertGitHubOAuthConfigured();
    const scope = 'repo admin:repo_hook'; // Permissions for repo and webhook
    let url = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${scope}`;
    
    // Add login parameter to force account selection if requested
    if (forceLogin) {
        url += '&prompt=select_account';
    }
    
    return url;
}

//exchange code for access token this will return access tolem required for all activities
async function exchangeCodeForToken(code) {
    try {
        const response = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
            },
            {
                headers: { Accept: 'application/json' },
            }
        );

        if (response.data.error) {
            throw new Error(response.data.error_description);
        }

        return response.data.access_token;
    } catch (err) { // Use `err` as the error object
        console.error('Error exchanging code for token:', err.message);
        throw new Error('Failed to exchange code for token'); // Re-throw or handle as needed
    }
}

//save access token inside database
async function saveAccessToken(userId, accessToken) {
    try {
        const encrypted = encryptToken(accessToken);

        // console.log("token encrytpion done");
        //stringify token for storing in database
        const encryptedData = JSON.stringify({
            token: encrypted.encryptedData,
            iv: encrypted.iv, //stoer iv with encrypted toekn for decrypt securely
        });

        // console.log("token stringified");

        //check if the user already has a token stored
        const existingToken = await prisma.oAuthToken.findUnique({
            where: { userId },
        });

        if (existingToken) {
            // Update the existing token
            const updatedToken = await prisma.oAuthToken.update({
                where: { userId },
                data: { token: encryptedData },
            });
           
            return updatedToken;
        } else {
            // Create a new token entry
            const newToken = await prisma.oAuthToken.create({
                data: {
                    userId,
                    token: encryptedData,
                },
            });
            
            return newToken;
        }
    }
    catch (e) {
        console.error('Error saving access token:', e);
        throw new Error('Failed to save access token');
    }

}

//main working helpers
// Query params:
//   ?force=true  - Force GitHub login screen (switch accounts)
//   (default)    - Use existing GitHub session
async function githubRedirect(req, res) {
    try {
        const forceLogin = req.query.force === 'true';
        const authUrl = getGitHubAuthUrl(forceLogin);
        res.json({ 
            success: true, 
            message: forceLogin 
                ? 'Redirect to GitHub to select account' 
                : 'Redirect to GitHub for authentication', 
            authUrl 
        });
    }
    catch (e) {
        const status = e.code === 'GITHUB_OAUTH_NOT_CONFIGURED' ? 503 : 500;
        res.status(status).json({
            success: false,
            code: e.code || 'GITHUB_AUTH_URL_ERROR',
            message: e.message || 'error generating github redirect url'
        });
    }
}
async function githubCallback(req, res) {
    const { code } = req.query || req.body;
    if (!code) {
        return res.redirect(`${FRONTEND_URL}/auth/error?message=Missing+code+parameter`);
    }

    try {
        const accessToken = await exchangeCodeForToken(code);
        const githubUser = await getUserInfoHelper(accessToken);

        let user = await prisma.user.findFirst({
            where: { email: githubUser.email || `${githubUser.login}@github.local` }
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: githubUser.email || `${githubUser.login}@github.local`,
                    name: githubUser.name || githubUser.login,
                }
            });
        }

        await saveAccessToken(user.id, accessToken);

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, githubLogin: githubUser.login },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Set JWT as httpOnly cookie (secure - not accessible via JavaScript)
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/'
        });

        // Redirect without token in URL - frontend reads from cookie
        res.redirect(`${FRONTEND_URL}/new/callback?auth=success`);
    } catch (error) {
        console.error('GitHub OAuth error:', error.message);
        res.redirect(`${FRONTEND_URL}/new/callback?error=${encodeURIComponent(error.message)}`);
    }
}

//getting user information from access
async function getUserInfoHelper(accessToken) {
    try {
        const response = await axios.get('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        return response.data; // Return the user info like login, name, email, etc.
    } catch (error) {
        throw new Error('Failed to fetch user info from GitHub');
    }
}

// Helper function to fetch repositories from GitHub
async function fetchRepositoriesFromGitHub(accessToken) {
    try {
        const response = await axios.get('https://api.github.com/user/repos', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        return response.data; // Return the array of repositories
    } catch (error) {
        throw new Error('Failed to fetch repositories from GitHub');
    }
}


async function getGitHubTokenFromJWT(req) {
    // Use shared extractToken to check both header AND cookie
    const token = extractToken(req);
    if (!token) {
        return null;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const oauthToken = await prisma.oAuthToken.findUnique({
            where: { userId: decoded.userId }
        });

        if (!oauthToken) {
            return null;
        }

        return decryptToken(oauthToken.token);
    } catch (error) {
        console.error('Error extracting GitHub token from JWT:', error.message);
        return null;
    }
}

async function getUserInfo(req, res) {
    try {
        // Only get token from encrypted DB storage via JWT (secure)
        const accessToken = await getGitHubTokenFromJWT(req);

        if (!accessToken) {
            return res.status(401).json({ 
                success: false, 
                message: 'GitHub account not linked or session expired' 
            });
        }

        const userInfo = await getUserInfoHelper(accessToken);
        res.json(userInfo);
    } catch (err) {
        res.status(500).send({
            success: false,
            message: 'Error fetching user info',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

async function listRepositories(req, res) {
    try {
        // Only get token from encrypted DB storage via JWT (secure)
        const accessToken = await getGitHubTokenFromJWT(req);

        if (!accessToken) {
            return res.status(401).json({ 
                success: false, 
                message: 'GitHub account not linked or session expired' 
            });
        }

        const repositories = await fetchRepositoriesFromGitHub(accessToken);

        //send repositories in the response
        res.json(repositories);
    }
    catch (err) {
        res.status(500).send({
            success: false,
            message: 'Error fetching repositories',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}


//basic helper functions
function encryptToken(token) {
    try {
        const algorithm = 'aes-256-cbc';
        const secretKey = process.env.SECRET_KEY;

        // Validate that SECRET_KEY is defined and has the correct length (32 bytes for aes-256-cbc)
        if (!secretKey || secretKey.length !== 32) {
            throw new Error('SECRET_KEY must be defined and 32 bytes long.');
        }

        const iv = crypto.randomBytes(16); // Initialization vector (16 bytes)

        const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
        let encrypted = cipher.update(token, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        return {
            encryptedData: encrypted,
            iv: iv.toString('hex'),
        };
    } catch (err) {
        console.error('Error encrypting token:', err.message);
        throw new Error('Encryption failed. Ensure that SECRET_KEY is properly configured.');
    }
}


//decrypt token when needed
function decryptToken(encryptedData) {
    const algorithm = 'aes-256-cbc';
    const secretKey = process.env.SECRET_KEY;
    const { token, iv } = JSON.parse(encryptedData);

    const decipher = crypto.createDecipheriv(
        algorithm,
        secretKey,
        Buffer.from(iv, 'hex')
    );

    let decrypted = decipher.update(token, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Disconnect GitHub account - removes OAuth token from database
 */
async function disconnectGithub(req, res) {
    try {
        const userId = req.user?.userId;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        // Delete the OAuth token for this user
        const deleted = await prisma.oAuthToken.delete({
            where: { userId }
        }).catch(() => null); // Return null if not found

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: 'GitHub account not linked'
            });
        }

        res.json({
            success: true,
            message: 'GitHub account disconnected successfully'
        });
    } catch (error) {
        console.error('Error disconnecting GitHub:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to disconnect GitHub account',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

module.exports = {
    getGitHubAuthUrl,
    exchangeCodeForToken,
    saveAccessToken,
    githubRedirect,
    githubCallback,
    getUserInfo,
    listRepositories,
    disconnectGithub
};
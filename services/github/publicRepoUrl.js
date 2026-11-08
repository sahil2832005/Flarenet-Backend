// Accepts a public GitHub repository URL and nothing else.
// Canonical form is https://github.com/owner/repo. Branch is set only when the URL names one.

const NAME = /^[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;

function reject(message) {
    return { ok: false, message };
}

function parsePublicGitHubRepo(input) {
    if (typeof input !== 'string' || input.trim() === '') {
        return reject('A public GitHub repository URL is required');
    }

    let url;
    try {
        url = new URL(input.trim());
    } catch (error) {
        return reject('Enter a URL like https://github.com/owner/repo');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return reject('Enter a URL like https://github.com/owner/repo');
    }

    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') {
        return reject('Only a github.com repository URL is accepted');
    }

    if (url.search || url.hash) {
        return reject('Paste the repository URL without extra parameters');
    }

    const parts = url.pathname.split('/').filter(Boolean).map((part) => {
        try {
            return decodeURIComponent(part);
        } catch (error) {
            return part;
        }
    });

    if (parts.length < 2) {
        return reject('Include the owner and repository, like https://github.com/owner/repo');
    }

    const owner = parts[0];
    let repo = parts[1];
    if (repo.endsWith('.git')) {
        repo = repo.slice(0, -4);
    }

    if (!NAME.test(owner) || !NAME.test(repo)) {
        return reject('That repository URL is not valid');
    }

    let branch = null;
    if (parts.length === 2) {
        branch = null;
    } else if (parts.length === 4 && parts[2] === 'tree') {
        branch = parts[3];
        if (!BRANCH.test(branch) || branch.includes('..')) {
            return reject('That branch name is not valid');
        }
    } else {
        return reject('Paste the repository URL, not a file or folder inside it');
    }

    return {
        ok: true,
        owner,
        repo,
        branch,
        gitUrl: `https://github.com/${owner}/${repo}`,
    };
}

module.exports = { parsePublicGitHubRepo };

let Octokit;
const { getRedisClient, isRedisAvailable } = require('../../clients/redisClient');

class GitHubService {
  constructor(options = {}) {
    this.cacheTTL = options.cacheTTL || 3600;
  }

  async createOctokitClient(token) {
    if (!Octokit) {
      const { Octokit: OctokitModule } = await import('@octokit/core');
      Octokit = OctokitModule;
    }
    
    if (!token) {
      throw new Error('GitHub token is required');
    }

    return new Octokit({
      auth: token,
      userAgent: 'FlareNet-Deployment-Validator',
      timeZone: 'UTC',
      baseUrl: 'https://api.github.com',
      request: {
        timeout: 10000 // 10 seconds timeout
      }
    });
  }

  getCacheKey(owner, repo, path) {
    return `github:repo:${owner}:${repo}:${path}`;
  }

  async getFileContent({ owner, repo, path, token }) {
    if (!owner || !repo || !path) {
      throw new Error('Owner, repo and path are required');
    }

    const cacheKey = this.getCacheKey(owner, repo, path);
    if (isRedisAvailable()) {
      const redis = getRedisClient();
      const cachedContent = await redis.get(cacheKey);
      
      if (cachedContent) {
        try {
          return JSON.parse(cachedContent);
        } catch (error) {
          console.error('Error parsing cached content:', error);
          // Continue to fetch from GitHub if cache parsing fails
        }
      }
    }

    try {
      const octokit = await this.createOctokitClient(token);
      
      const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (response.status !== 200) {
        throw new Error(`GitHub API returned status ${response.status}`);
      }

      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      const parsedContent = JSON.parse(content);

      if (isRedisAvailable()) {
        const redis = getRedisClient();
        await redis.set(cacheKey, JSON.stringify(parsedContent), 'EX', this.cacheTTL);
      }
      
      return parsedContent;
    } catch (error) {
      if (error.status === 404) {
        throw new Error(`File '${path}' not found in repository ${owner}/${repo}`);
      } else if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
        throw new Error('GitHub API rate limit exceeded. Please try again later.');
      } else if (error.status === 401) {
        throw new Error('Invalid or expired GitHub token');
      } else if (error.message.includes('JSON')) {
        throw new Error(`Invalid ${path} format`);
      }
      
      throw new Error(`Error fetching ${path}: ${error.message}`);
    }
  }

  parseGitHubUrl(url) {
    if (!url) {
      throw new Error('GitHub URL is required');
    }

    try {
      let urlObj;
      try {
        urlObj = new URL(url);
      } catch (error) {
        throw new Error('Invalid GitHub URL format');
      }

      if (!urlObj.hostname.includes('github.com')) {
        throw new Error('Not a GitHub URL');
      }

      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      
      if (pathParts.length < 2) {
        throw new Error('Invalid GitHub repository URL');
      }

      return {
        owner: pathParts[0],
        repo: pathParts[1]
      };
    } catch (error) {
      throw new Error(`Error parsing GitHub URL: ${error.message}`);
    }
  }
}

module.exports = GitHubService; 
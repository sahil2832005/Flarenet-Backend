// Using dynamic import for ESM module
let Octokit;
const { getRedisClient, isRedisAvailable } = require('../../clients/redisClient');

class GitHubService {
  /**
   * Create a new GitHubService instance
   * @param {Object} options - Configuration options
   * @param {Number} options.cacheTTL - Cache time-to-live in seconds (default: 3600)
   */
  constructor(options = {}) {
    this.cacheTTL = options.cacheTTL || 3600; // Default 1 hour cache
  }

  /**
   * Create an authenticated Octokit instance
   * @param {String} token - GitHub token
   * @returns {Object} Octokit instance
   */
  async createOctokitClient(token) {
    // Dynamically import Octokit if not already loaded
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

  /**
   * Get cache key for GitHub API requests
   * @param {String} owner - Repository owner
   * @param {String} repo - Repository name
   * @param {String} path - File path
   * @returns {String} Cache key
   */
  getCacheKey(owner, repo, path) {
    return `github:repo:${owner}:${repo}:${path}`;
  }

  /**
   * Get file content from GitHub repository
   * @param {Object} params - Request parameters
   * @param {String} params.owner - Repository owner
   * @param {String} params.repo - Repository name
   * @param {String} params.path - File path
   * @param {String} params.token - GitHub token
   * @returns {Promise<Object>} File content
   */
  async getFileContent({ owner, repo, path, token }) {
    if (!owner || !repo || !path) {
      throw new Error('Owner, repo and path are required');
    }

    // Try to get from cache first
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
      else{
        // console.log("response from github failing stepper",response);
      }
      

      // Decode base64 content
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      const parsedContent = JSON.parse(content);

      console.log("parsed content from github",parsedContent);
      
      // Cache the result if Redis is available
      if (isRedisAvailable()) {
        const redis = getRedisClient();
        await redis.set(cacheKey, JSON.stringify(parsedContent), 'EX', this.cacheTTL);
      }
      
      return parsedContent;
    } catch (error) {
      // Handle specific GitHub API errors
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

  /**
   * Parse GitHub repository URL
   * @param {String} url - GitHub repository URL
   * @returns {Object} Repository owner and name
   */
  parseGitHubUrl(url) {
    if (!url) {
      throw new Error('GitHub URL is required');
    }

    try {
      // Handle different GitHub URL formats
      let urlObj;
      try {
        urlObj = new URL(url);
      } catch (error) {
        throw new Error('Invalid GitHub URL format');
      }

      if (!urlObj.hostname.includes('github.com')) {
        throw new Error('Not a GitHub URL');
      }

      // Extract owner and repo from path
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
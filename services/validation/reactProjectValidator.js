const GitHubService = require('../github/githubService');

/**
 * Service for validating React projects
 */
class ReactProjectValidator {
  /**
   * Create a new ReactProjectValidator instance
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.githubService = new GitHubService(options);
  }

  /**
   * Validate if a repository is a React project
   * @param {Object} params - Validation parameters
   * @param {String} params.owner - Repository owner
   * @param {String} params.repo - Repository name
   * @param {String} params.token - GitHub token
   * @returns {Promise<Object>} Validation result
   */
  async validateReactProject({ owner, repo, token }) {
    try {
      // Input validation
      if (!owner || !repo) {
        throw new Error('Repository owner and name are required');
      }

      if (!token) {
        throw new Error('GitHub token is required');
      }

      // Get package.json from repository for this we are using helper srevice file
      const packageJson = await this.githubService.getFileContent({
        owner,
        repo,
        path: 'package.json',
        token
      });

      console.log('Validating package.json:', {
        name: packageJson.name,
        hasWorkspaces: Boolean(packageJson.workspaces),
        hasDependencies: Boolean(packageJson.dependencies),
        hasDevDependencies: Boolean(packageJson.devDependencies),
        hasScripts: Boolean(packageJson.scripts)
      });

      // Check if it's a React project
      const isReact = this.hasReactDependency(packageJson);
      console.log('Is React project:', isReact);
      
      if (!isReact) {
        throw new Error('This is not a React project');
      }

      // Detect React framework
      const { framework, buildCommand } = this.detectReactFramework(packageJson);

      return {
        isValid: true,
        framework,
        buildCommand,
        dependencies: {
          react: packageJson.dependencies?.react || packageJson.devDependencies?.react,
          ...this.getRelevantDependencies(packageJson)
        }
      };
    } catch (error) {
      return {
        isValid: false,
        error: process.env.NODE_ENV === 'development' ? error.message : 'Validation failed'
      };
    }
  }

  /**
   * Check if package.json has React dependency
   * @param {Object} packageJson - package.json content
   * @returns {Boolean} Has React dependency
   */
  hasReactDependency(packageJson) {
    if (!packageJson) return false;
    
    // Direct React dependency check
    if (packageJson.dependencies?.react || packageJson.devDependencies?.react) {
      return true;
    }
    
    // Check for React-related packages
    const reactRelatedPackages = [
      'react-dom', 'react-scripts', 'react-native', 
      '@testing-library/react', 'react-router', 'react-redux'
    ];
    
    for (const pkg of reactRelatedPackages) {
      if (packageJson.dependencies?.[pkg] || packageJson.devDependencies?.[pkg]) {
        return true;
      }
    }
    
    // Check for workspaces (monorepo structure)
    if (packageJson.workspaces) {
      return true; // If it has workspaces, assume it might contain React in subpackages
    }
    
    // Check for React-related scripts
    if (packageJson.scripts) {
      const scriptValues = Object.values(packageJson.scripts).join(' ').toLowerCase();
      if (scriptValues.includes('react-scripts') || 
          scriptValues.includes('react ') || 
          scriptValues.includes(' react')) {
        return true;
      }
    }
    
    // Check package name for React-related keywords
    if (packageJson.name && 
        (packageJson.name.includes('react') || 
         packageJson.name.includes('cra'))) {
      return true;
    }
    
    return false;
  }

  /**
   * Get relevant dependencies from package.json
   * @param {Object} packageJson - package.json content
   * @returns {Object} Relevant dependencies
   */
  getRelevantDependencies(packageJson) {
    const relevantDeps = {};
    const depsToCheck = [
      'vite', 'react-scripts', 'next', 'gatsby',
      'webpack', 'babel', 'typescript', 'eslint'
    ];
    
    for (const dep of depsToCheck) {
      if (packageJson.dependencies?.[dep]) {
        relevantDeps[dep] = packageJson.dependencies[dep];
      } else if (packageJson.devDependencies?.[dep]) {
        relevantDeps[dep] = packageJson.devDependencies[dep];
      }
    }
    
    return relevantDeps;
  }

  /**
   * Detect React framework from package.json
   * @param {Object} packageJson - package.json content
   * @returns {Object} Framework and build command
   */
  detectReactFramework(packageJson) {
    if (!packageJson) {
      return { framework: 'Unknown', buildCommand: 'npm run build' };
    }

    // Check for specific React frameworks
    if (packageJson.dependencies?.vite || packageJson.devDependencies?.vite) {
      return { framework: 'Vite', buildCommand: this.getBuildCommand(packageJson, 'build') };
    } else if (packageJson.dependencies?.['react-scripts']) {
      return { framework: 'Create React App', buildCommand: this.getBuildCommand(packageJson, 'build') };
    } else if (packageJson.dependencies?.next) {
      return { framework: 'Next.js', buildCommand: this.getBuildCommand(packageJson, 'build') };
    } else if (packageJson.dependencies?.gatsby) {
      return { framework: 'Gatsby', buildCommand: this.getBuildCommand(packageJson, 'build') };
    } else {
      return { framework: 'Custom React', buildCommand: this.getBuildCommand(packageJson, 'build') };
    }
  }

  /**
   * Get build command from package.json scripts
   * @param {Object} packageJson - package.json content
   * @param {String} defaultScript - Default script name
   * @returns {String} Build command
   */
  getBuildCommand(packageJson, defaultScript = 'build') {
    if (packageJson.scripts && packageJson.scripts[defaultScript]) {
      return `npm run ${defaultScript}`;
    }
    
    // Look for alternative build scripts
    const buildScripts = ['build', 'prod', 'production', 'compile'];
    for (const script of buildScripts) {
      if (packageJson.scripts && packageJson.scripts[script]) {
        return `npm run ${script}`;
      }
    }
    
    return 'npm run build';
  }

  /**
   * Validate a GitHub repository URL
   * @param {String} url - GitHub repository URL
   * @param {String} token - GitHub token
   * @returns {Promise<Object>} Validation result
   */
  async validateReactProjectByUrl(url, token) {
    try {
      const { owner, repo } = this.githubService.parseGitHubUrl(url); //here this will return {owener and repo}
      return await this.validateReactProject({ owner, repo, token });
    } catch (error) {
      return {
        isValid: false,
        error: process.env.NODE_ENV === 'development' ? error.message : 'Validation failed'
      };
    }
  }
}

module.exports = ReactProjectValidator; 
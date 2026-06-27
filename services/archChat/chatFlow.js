/**
 * Architecture Chat Flow Definition
 * Finite State Machine for guided conversation
 */

const FLOW_STEPS = [
    // Step 1: Application Type
    {
        id: 'app_type',
        question: 'What type of application are you building?',
        options: [
            { value: 'webapp', label: 'Web Application', description: 'Full-stack web app with UI' },
            { value: 'api', label: 'REST API', description: 'Backend API service' },
            { value: 'realtime', label: 'Real-time App', description: 'Chat, gaming, live updates' }
        ]
    },
    // Step 2: Scale
    {
        id: 'scale',
        question: 'What scale do you expect?',
        options: [
            { value: 'small', label: 'Small', description: '< 1,000 users, MVP/prototype' },
            { value: 'medium', label: 'Medium', description: '1,000 - 100,000 users, growing startup' },
            { value: 'large', label: 'Large', description: '100,000+ users, enterprise scale' }
        ]
    },
    // Step 3: Resource Tier - Only 2 plans available
    {
        id: 'resource_tier',
        question: 'What resource allocation do you need?',
        options: [
            { value: 'starter', label: 'Starter', description: '2 vCPU, 4GB RAM, 50GB storage - Best for MVPs' },
            { value: 'standard', label: 'Standard', description: '4 vCPU, 8GB RAM, 100GB storage - Best for Production' }
        ]
    },
    // Step 4: Database
    {
        id: 'database',
        question: 'What type of data will you store primarily?',
        options: [
            { value: 'relational', label: 'Structured Data', description: 'Users, orders, transactions (SQL)' },
            { value: 'document', label: 'Flexible Documents', description: 'Content, logs, varied schemas (NoSQL)' },
            { value: 'both', label: 'Mixed', description: 'Both structured and flexible data' }
        ]
    },
    // Step 5: Features
    {
        id: 'features',
        question: 'Which features do you need?',
        multiSelect: true,
        options: [
            { value: 'auth', label: 'Authentication', description: 'User login, OAuth' },
            { value: 'cache', label: 'Caching', description: 'Fast data access, sessions' },
            { value: 'queue', label: 'Background Jobs', description: 'Async processing, emails' },
            { value: 'search', label: 'Full-text Search', description: 'Search functionality' },
            { value: 'files', label: 'File Storage', description: 'Images, documents, uploads' },
            { value: 'websocket', label: 'Real-time Updates', description: 'Live notifications, chat' }
        ]
    },
    // Step 6: Compliance (NEW - Phase 1)
    {
        id: 'compliance',
        question: 'Do you have compliance requirements?',
        multiSelect: true,
        options: [
            { value: 'none', label: 'None', description: 'No specific compliance' },
            { value: 'soc2', label: 'SOC 2', description: 'Security audit requirements' },
            { value: 'hipaa', label: 'HIPAA', description: 'Healthcare data' },
            { value: 'gdpr', label: 'GDPR', description: 'EU data protection' },
            { value: 'pci', label: 'PCI-DSS', description: 'Payment card data' },
            { value: 'iso27001', label: 'ISO 27001', description: 'Information security' }
        ]
    },
    // Step 7: Traffic
    {
        id: 'traffic',
        question: 'What traffic pattern do you expect?',
        options: [
            { value: 'steady', label: 'Steady', description: 'Consistent traffic throughout' },
            { value: 'spiky', label: 'Spiky', description: 'Sudden bursts (sales, events)' },
            { value: 'growing', label: 'Growing', description: 'Gradual increase over time' }
        ]
    },
    // Step 8: Availability - Only 2 levels available
    {
        id: 'availability',
        question: 'What uptime do you need?',
        options: [
            { value: 'standard', label: '99%', description: 'Single container, basic restarts - For Starter tier' },
            { value: 'high', label: '99.9%', description: 'Multiple replicas, health checks - For Standard tier' }
        ]
    },
    // Step 9: Network Isolation (NEW - Phase 1)
    {
        id: 'network_isolation',
        question: 'What network isolation do you need?',
        options: [
            { value: 'shared', label: 'Shared Network', description: 'Standard isolation, cost-effective' },
            { value: 'dedicated_vlan', label: 'Dedicated VLAN', description: 'Your own network segment' },
            { value: 'private', label: 'Private Network', description: 'Fully isolated, no public access' }
        ]
    },
    // Step 10: Team Size (NEW - Phase 1)
    {
        id: 'team_size',
        question: 'How big is your engineering team?',
        options: [
            { value: 'solo', label: '1-2 developers', description: 'Solo or pair' },
            { value: 'small', label: '3-10 developers', description: 'Small team' },
            { value: 'medium', label: '11-50 developers', description: 'Multiple teams' },
            { value: 'large', label: '50+ developers', description: 'Enterprise scale' }
        ]
    },
    // Step 11: Managed Level (NEW - Phase 1)
    {
        id: 'managed_level',
        question: 'How much should we manage for you?',
        options: [
            { value: 'templates_only', label: 'Just Templates', description: 'I deploy manually' },
            { value: 'semi_managed', label: 'Semi-Managed', description: 'You deploy, I configure & monitor' },
            { value: 'full_managed', label: 'Fully Managed', description: 'You deploy, secure & manage everything' }
        ]
    },
    // Step 12: Budget (moved to end for pricing clarity)
    {
        id: 'budget',
        question: 'What is your infrastructure budget preference?',
        options: [
            { value: 'minimal', label: 'Minimal', description: 'Keep costs very low, free tiers' },
            { value: 'moderate', label: 'Moderate', description: 'Balance cost and performance' },
            { value: 'flexible', label: 'Flexible', description: 'Willing to invest for best solution' }
        ]
    }
];

/**
 * Get the current step definition
 */
function getStep(stepId) {
    return FLOW_STEPS.find(step => step.id === stepId);
}

/**
 * Get the first step
 */
function getFirstStep() {
    return FLOW_STEPS[0];
}

/**
 * Get next step based on current step
 */
function getNextStep(currentStepId) {
    const currentIndex = FLOW_STEPS.findIndex(step => step.id === currentStepId);
    if (currentIndex === -1 || currentIndex >= FLOW_STEPS.length - 1) {
        return null; // No more steps
    }
    return FLOW_STEPS[currentIndex + 1];
}

/**
 * Check if this is the last step
 */
function isLastStep(stepId) {
    return FLOW_STEPS[FLOW_STEPS.length - 1].id === stepId;
}

/**
 * Validate answer against step options
 */
function validateAnswer(stepId, answer) {
    const step = getStep(stepId);
    if (!step) return { valid: false, error: 'Invalid step' };

    if (step.multiSelect) {
        // Answer should be an array
        if (!Array.isArray(answer)) {
            return { valid: false, error: 'Expected array for multi-select' };
        }
        const validValues = step.options.map(o => o.value);
        const allValid = answer.every(a => validValues.includes(a));
        if (!allValid) {
            return { valid: false, error: 'Invalid option selected' };
        }
        return { valid: true };
    } else {
        // Single answer
        const validValues = step.options.map(o => o.value);
        if (!validValues.includes(answer)) {
            return { valid: false, error: 'Invalid option selected' };
        }
        return { valid: true };
    }
}

/**
 * Get all step IDs
 */
function getAllStepIds() {
    return FLOW_STEPS.map(step => step.id);
}

/**
 * Check if all steps are completed
 */
function isFlowComplete(answers) {
    const requiredSteps = getAllStepIds();
    return requiredSteps.every(stepId => answers.hasOwnProperty(stepId));
}

module.exports = {
    FLOW_STEPS,
    getStep,
    getFirstStep,
    getNextStep,
    isLastStep,
    validateAnswer,
    getAllStepIds,
    isFlowComplete
};

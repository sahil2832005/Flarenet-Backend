process.env.ARCH_CHAT_FOCUS_MODE = 'small_starter';

const userId = 1;
const projectId = '11111111-1111-4111-8111-111111111111';

const store = {
    architecture: null,
};

jest.mock('../clients/prismaClient', () => {
    const prisma = {
        project: {
            findUnique: jest.fn(async ({ where }) => {
                if (where.id !== projectId) return null;
                return {
                    id: projectId,
                    ownerId: userId,
                    architecture: store.architecture,
                };
            }),
        },
        projectArchitecture: {
            create: jest.fn(async ({ data }) => {
                store.architecture = {
                    ...data,
                    status: 'IN_PROGRESS',
                    recommendation: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                return store.architecture;
            }),
            update: jest.fn(async ({ data }) => {
                store.architecture = {
                    ...store.architecture,
                    ...data,
                    createdAt: store.architecture.createdAt,
                    updatedAt: new Date(),
                };
                return store.architecture;
            }),
            findUnique: jest.fn(async () => store.architecture),
        },
        $disconnect: jest.fn(),
    };

    return { prisma };
});

const archChat = require('../services/archChat');
const { isValidProjectId } = require('../routes/archChatRoutes');

const GOLDEN_PATH = [
    'webapp',
    'small',
    'starter',
    'relational',
    ['auth', 'cache'],
    'steady',
    'standard',
    'solo',
    'templates_only',
    'minimal',
];

describe('Starter plan', () => {
    beforeEach(() => {
        store.architecture = null;
    });

    async function answerUntil(stepCount) {
        const started = await archChat.startChat(projectId, userId);
        expect(started.error).toBeUndefined();
        for (const answer of GOLDEN_PATH.slice(0, stepCount)) {
            const step = await archChat.answerQuestion(projectId, answer, userId);
            expect(step.error).toBeUndefined();
        }
    }

    test('saves a Simple Monolith on the Starter tier', async () => {
        const started = await archChat.startChat(projectId, userId);
        expect(started.error).toBeUndefined();

        let result;
        for (const answer of GOLDEN_PATH) {
            result = await archChat.answerQuestion(projectId, answer, userId);
            expect(result.error).toBeUndefined();
            expect(result.blocked).toBeUndefined();
        }

        expect(result.completed).toBe(true);
        expect(store.architecture.status).toBe('COMPLETED');
        expect(store.architecture.recommendation.name).toBe('Simple Monolith (Solo-friendly)');
        expect(store.architecture.recommendation.tier).toBe('small');
        expect(store.architecture.recommendation.resourceTier).toBe('starter');
        expect(store.architecture.recommendation.resourceAllocation.tier.totalCpu).toBe(2);
        expect(store.architecture.recommendation.resourceAllocation.tier.totalMemory).toBe(4096);
        expect(result.result.starterPlan).toEqual({
            plan: 'starter',
            cpu: 2,
            memoryMb: 4096,
            storageGb: 50,
            replicas: 1,
            availability: 'standard',
            runtime: 'Node.js monolith',
            database: 'PostgreSQL',
            features: ['auth', 'cache'],
        });
        expect(store.architecture.recommendation.starterPlan).toEqual(result.result.starterPlan);
    });

    test('fills a missing tier with Starter, not Standard', () => {
        const ruleEngine = require('../services/archChat/ruleEngine');
        const architecture = ruleEngine.generateArchitecture({
            features: ['cache', 'auth', 'auth'],
        });

        expect(architecture.resourceTier).toBe('starter');
        expect(architecture.starterPlan.cpu).toBe(2);
        expect(architecture.starterPlan.memoryMb).toBe(4096);
        expect(architecture.starterPlan.features).toEqual(['cache', 'auth']);
    });

    test('rejects another user before reading or changing the session', async () => {
        const started = await archChat.startChat(projectId, userId);
        expect(started.error).toBeUndefined();

        const denied = await archChat.answerQuestion(projectId, 'webapp', 2);
        expect(denied.code).toBe('UNAUTHORIZED');
        expect(store.architecture.currentStep).toBe('app_type');

        const missingUser = await archChat.getSessionState(projectId, null);
        expect(missingUser.code).toBe('UNAUTHORIZED');

        const missingProject = await archChat.resetSession('22222222-2222-4222-8222-222222222222', userId);
        expect(missingProject.code).toBe('PROJECT_NOT_FOUND');
    });

    test('rejects a non-uuid project id', () => {
        expect(isValidProjectId(projectId)).toBe(true);
        expect(isValidProjectId('not-a-uuid')).toBe(false);
        expect(isValidProjectId(111)).toBe(false);
    });

    test('requires auth and cache without duplicate features', async () => {
        await archChat.startChat(projectId, userId);
        const beforeFeatures = GOLDEN_PATH.slice(0, 4);
        for (const answer of beforeFeatures) {
            const step = await archChat.answerQuestion(projectId, answer, userId);
            expect(step.error).toBeUndefined();
        }

        const empty = await archChat.answerQuestion(projectId, [], userId);
        expect(empty.code).toBe('OPTION_NOT_AVAILABLE');

        const duplicate = await archChat.answerQuestion(projectId, ['auth', 'cache', 'auth'], userId);
        expect(duplicate.code).toBe('OPTION_NOT_AVAILABLE');

        const accepted = await archChat.answerQuestion(projectId, ['auth', 'cache', 'files'], userId);
        expect(accepted.error).toBeUndefined();
    });

    test('does not save queue or 99.9% availability', async () => {
        await answerUntil(4);
        const queued = await archChat.answerQuestion(projectId, ['auth', 'cache', 'queue'], userId);
        expect(queued.code).toBe('OPTION_NOT_AVAILABLE');
        expect(queued.value).toBe('queue');
        expect(store.architecture.currentStep).toBe('features');
        expect(store.architecture.features).toBeUndefined();

        const features = await archChat.answerQuestion(projectId, ['auth', 'cache'], userId);
        expect(features.error).toBeUndefined();
        expect(store.architecture.features).toEqual(['auth', 'cache']);

        const steady = await archChat.answerQuestion(projectId, 'steady', userId);
        expect(steady.error).toBeUndefined();

        const high = await archChat.answerQuestion(projectId, 'high', userId);
        expect(high.code).toBe('OPTION_NOT_AVAILABLE');
        expect(high.value).toBe('high');
        expect(store.architecture.currentStep).toBe('availability');
        expect(store.architecture.availability).toBeUndefined();
        expect(store.architecture.status).toBe('IN_PROGRESS');
        expect(store.architecture.recommendation).toBeNull();

        const standard = await archChat.answerQuestion(projectId, 'standard', userId);
        expect(standard.error).toBeUndefined();
        expect(store.architecture.availability).toBe('standard');
    });

    test('refuses to go back after the chat is completed', async () => {
        await archChat.startChat(projectId, userId);
        let result;
        for (const answer of GOLDEN_PATH) {
            result = await archChat.answerQuestion(projectId, answer, userId);
        }
        expect(result.completed).toBe(true);

        const back = await archChat.goBack(projectId, userId);
        expect(back.code).toBe('SESSION_COMPLETED');
    });
});

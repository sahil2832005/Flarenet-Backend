/**
 * Idempotent seed: dev@flarenet.com + one test project.
 * Run: node prisma/seed-test-dev.js
 * Docker: docker compose exec -T backend node prisma/seed-test-dev.js
 */
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEV_EMAIL = 'dev@flarenet.com';
const DEV_PASSWORD = 'Test1234';
const DEV_NAME = 'Dev Tester';
const PROJECT_NAME = 'FlareNet Test App';
const PROJECT_GIT_URL = 'https://github.com/example/flarenet-test-app';
const PROJECT_DESCRIPTION = 'Local test project for arch chat and diagram builder (no GitHub OAuth).';

async function main() {
    const hashedPassword = await bcrypt.hash(DEV_PASSWORD, 10);

    const user = await prisma.user.upsert({
        where: { email: DEV_EMAIL },
        update: {
            password: hashedPassword,
            name: DEV_NAME,
        },
        create: {
            email: DEV_EMAIL,
            password: hashedPassword,
            name: DEV_NAME,
        },
    });

    let project = await prisma.project.findFirst({
        where: {
            ownerId: user.id,
            name: PROJECT_NAME,
        },
    });

    if (!project) {
        project = await prisma.project.create({
            data: {
                name: PROJECT_NAME,
                gitUrl: PROJECT_GIT_URL,
                description: PROJECT_DESCRIPTION,
                ownerId: user.id,
            },
        });
        console.log('Created test project.');
    } else {
        console.log('Test project already exists.');
    }

    console.log('');
    console.log('--- Test account ---');
    console.log('Email:    ', DEV_EMAIL);
    console.log('Password: ', DEV_PASSWORD);
    console.log('User ID:  ', user.id);
    console.log('');
    console.log('--- Test project ---');
    console.log('Project ID:', project.id);
    console.log('Name:      ', project.name);
    console.log('Git URL:   ', project.gitUrl);
    console.log('');
    console.log('Frontend paths:');
    console.log(`  /projects/${project.id}/configure`);
    console.log(`  /projects/${project.id}/architect`);
    console.log(`  /projects/${project.id}/diagram`);
}

main()
    .catch((err) => {
        console.error('Seed failed:', err.message);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());

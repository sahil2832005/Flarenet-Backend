const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '.env') });
process.env.REDIS_ENABLED = 'true';

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { prisma } = require('./clients/prismaClient');
const { getRedisClient } = require('./clients/redisClient');
const { startWorkers } = require('./worker/startWorkers');
const githubRoutes = require('./routes/githubRoutes');
const authRoutes = require('./routes/authRoutes');
const chatbotRoutes = require('./routes/chatBotRoutes');
const archChatRoutes = require('./routes/archChatRoutes');
const archChat = require('./services/archChat');
const deploymentValidationRoutes = require('./routes/deploymentValidationRoutes');
const aiAnalysisRoutes = require('./routes/aiAnalysisRoutes');
const projectRoutes = require('./routes/projectRoutes');
const deployRoutes = require('./routes/deployRoutes');
const logRoutes = require('./routes/logRoutes');
const validationRoutes = require('./routes/validationRoutes');

const PORT = 5000;
const app = express();
let server;
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

    if (server) {
        server.close(async () => {
            console.log('[Server] HTTP server closed');

            try {
                const redis = getRedisClient();
                if (redis) await redis.quit();
                console.log('[Server] Redis connection closed');
            } catch (e) { /* ignore */ }

            try {
                await prisma.$disconnect();
                console.log('[Server] Database connection closed');
            } catch (e) { /* ignore */ }

            process.exit(0);
        });
    }

    setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

getRedisClient();

app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:4200',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'flarenet-backend', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

app.use('/api/github', githubRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/validdeployment', deploymentValidationRoutes);
app.use('/api/ai-analysis', aiAnalysisRoutes);
app.use('/api/llm', chatbotRoutes);
app.use('/api/arch-chat', archChatRoutes);
app.use('/api/validate', validationRoutes);
app.use(projectRoutes);
app.use(deployRoutes);
app.use(logRoutes);

async function checkDatabase() {
    try {
        await prisma.$queryRaw`SELECT 1`;
        console.log('[Server] Database connected');
    } catch (error) {
        console.error('Error connecting to the database:', error.message);
    }
}

checkDatabase();

archChat.initialize().catch(err => {
    console.error('[ArchChat] Initialization error:', err.message);
});

startWorkers();

server = app.listen(PORT, () => console.log(`API Server Running..${PORT}`));

module.exports = app;

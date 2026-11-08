const path = require('path');
const { Worker: ThreadWorker } = require('worker_threads');

const WORKER_FILES = ['deploymentWorker.js', 'failedQueueWorker.js', 'webHooksWorker.js'];

function startWorkers() {
    WORKER_FILES.forEach((file) => {
        const workerPath = path.join(__dirname, file);
        const workerThread = new ThreadWorker(workerPath);
        workerThread.on('error', (err) => {
            console.error(`Error in worker thread for ${workerPath}`, err);
        });
    });
}

module.exports = { startWorkers };

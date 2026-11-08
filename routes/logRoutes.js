const express = require('express');
const clickHouseClient = require('../clients/clickHouseClient');

const router = express.Router();

router.get('/getLogs/:id', async function (req, res) {
    try {
        const id = req.params.id;

        const logs = await clickHouseClient.query({
            query: `SELECT event_id, deployment_id, log_message, log_level, file_name, file_size, file_size_in_bytes, time_taken, timestamp
                    FROM deployment_logs
                    WHERE deployment_id = {deployment_id:String}`,
            query_params: {
                deployment_id: id,
            },
            format: 'JSONEachRow',
        });

        const rawLogs = await logs.json();

        return res.json({ success: true, logs: rawLogs });
    } catch (e) {
        res.status(500).json({
            success: false,
            message: 'Internal error',
            error: process.env.NODE_ENV === 'development' ? e.message : undefined,
        });
    }
});

module.exports = router;

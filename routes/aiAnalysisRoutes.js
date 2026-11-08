const express = require('express');
const router = express.Router();
const clickHouseClient = require('../clients/clickHouseClient');
const { verifyToken } = require('../middlewares/authMiddleware');

// Get AI analysis for a specific deployment (protected route)
router.get('/:deploymentId', verifyToken, async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const { from, to, limit = 100 } = req.query;

        let query = `
            SELECT 
                log_event_id,
                deployment_id,
                classification,
                reasoning,
                timestamp
            FROM deployment_ai_analysis
            WHERE deployment_id = {deployment_id:String}
        `;

        // Add time range if provided
        if (from && to) {
            query += ` AND timestamp BETWEEN {from:String} AND {to:String}`;
        }

        query += ` ORDER BY timestamp DESC LIMIT {limit:UInt32}`;

        const result = await clickHouseClient.query({
            query,
            query_params: {
                deployment_id: deploymentId,
                from: from || '1970-01-01',
                to: to || '2100-01-01',
                limit: parseInt(limit)
            },
            format: 'JSONEachRow'
        });

        const analyses = await result.json();

        res.json({
            success: true,
            data: analyses
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch AI analysis',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;
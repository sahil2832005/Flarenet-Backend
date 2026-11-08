const { createClient } = require('@clickhouse/client');

// Environment variables are loaded by index.js
const clickHouseClient = createClient({
    url: process.env.CH_URI || 'http://clickhouse:8123',
    username: process.env.CH_USERNAME || 'default',
    password: process.env.CH_PASS || 'default',
    format: 'json',
});



async function testConnection() {
    try {
        const query = 'SELECT version()';
        console.log('Executing query:', query);

        const resultSet = await clickHouseClient.query({ query, format: 'JSONEachRow' });

        console.log('ClickHouse Version:', await resultSet.json()); // Properly handle JSON response
    } catch (error) {
        console.error('Error querying ClickHouse:', error);
    }
}

// Run the test connection
testConnection();

module.exports = clickHouseClient;

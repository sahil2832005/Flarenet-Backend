const { Kafka } = require('kafkajs');

// Environment variables are loaded by index.js
const kafka = new Kafka({
    clientId: `api-server-receiver_side`,
    brokers: [`${process.env.KAFKA_BROKER}`],
});

// Only log in development
if (process.env.NODE_ENV !== 'production') {
    console.log('Kafka broker:', process.env.KAFKA_BROKER ? 'Configured' : 'Not set');
}

module.exports = kafka;
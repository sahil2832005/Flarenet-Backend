require('dotenv').config({ path: '../.env' });
const { ECSClient } = require('@aws-sdk/client-ecs');

const client = new ECSClient({
    region: process.env.FLARENET_AWS_REGION,
    credentials: {
        accessKeyId: process.env.FLARENET_AWS_ACCESSKEY,
        secretAccessKey: process.env.FLARENET_AWS_SECRETACCESSKEY
    }
});

module.exports = { client };

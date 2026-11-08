const { PrismaClient } = require('@prisma/client');

// Set up the Prisma client
const prisma = new PrismaClient();

module.exports = {prisma};
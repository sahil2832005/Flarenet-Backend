// Environment variables are loaded by index.js
const { createAdvancedAgent } = require("../services/llm/agent.service");

// LLM provider is not selected yet. Chat and deployment analysis stay disabled
// until a model client is wired here.
const llm = null;
const memory = null;

module.exports = {
    llm,
    memory,
    createAgent: createAdvancedAgent
};

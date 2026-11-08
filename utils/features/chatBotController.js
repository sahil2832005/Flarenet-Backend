const { prisma } = require("../../clients/prismaClient");
const buildQueue = require("../../queues/buildQueue");
const { llm, memory } = require("../../utils/langchainConfig");
const { getRedisClient } = require("../../clients/redisClient");

// Use shared Redis client
const redis = getRedisClient();

if (redis) {
    redis.on('error', (err) => console.error('Redis Client Error:', err));
    redis.on('connect', () => console.log('Redis Client Connected'));
}

// Helper function to clean LLM responses
function cleanLLMResponse(response) {
    return response
        .replace(/^(Sure|Okay|Certainly|Here's|I'll|Let me).+?:\s*/s, '')
        .replace(/^.*?(Here is|This is).*?:\s*/s, '')
        .replace(/^---\s*/, '')
        .replace(/\s*---\s*$/, '')
        .replace(/^BEGIN YOUR RESPONSE WITH THE EXACT TEXT TO DISPLAY:\s*/, '')
        .trim();
}

// Helper function for direct extraction from messages
function extractDirectInfo(message) {
    const extracted = {
        name: null,
        gitUrl: null,
        description: null,
        ownerId: null
    };

    // Extract name patterns
    const namePatterns = [
        /my\s+(?:project\s+)?name\s+(?:is|:)?\s+["']?([^"'.,]+)["']?/i,
        /name\s+(?:is|:)?\s+["']?([^"'.,]+)["']?/i,
        /project\s+(?:called|named)\s+["']?([^"'.,]+)["']?/i
    ];

    for (const pattern of namePatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            extracted.name = match[1].trim();
            break;
        }
    }

    // Extract Git URL patterns
    const urlPatterns = [
        /git(?:hub|lab)?\s+(?:url|link|repo|repository)?\s+(?:is|:)?\s+(https?:\/\/[^\s]+\.git)/i,
        /(https?:\/\/github\.com\/[^\s]+\/[^\s]+(?:\.git)?)/i,
        /(https?:\/\/gitlab\.com\/[^\s]+\/[^\s]+(?:\.git)?)/i
    ];

    for (const pattern of urlPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            extracted.gitUrl = match[1].trim();
            break;
        }
    }

    // Extract description patterns - more flexible patterns
    const descPatterns = [
        /description\s+(?:is|:)?\s+["']?([^"']+)["']?/i,
        /project\s+(?:is|about)?\s+["']?([^"']+)["']?/i,
        /(?:it's|its)\s+a\s+([^,.]+)/i,
        /(?:this is|it is|creating)?\s*(?:a|an)?\s*([^,.]{5,})\s*(?:project|app|website|application)?/i,
        /(?:i am|i'm)\s+(?:building|making|creating|developing)\s+(?:a|an)?\s*([^,.]+)/i,
        /(?:i want to|trying to|going to)\s+(?:build|make|create|develop)\s+(?:a|an)?\s*([^,.]+)/i,
        /([^,.]{10,})\s*(?:project|app|website|application)$/i
    ];

    for (const pattern of descPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            extracted.description = match[1].trim();
            break;
        }
    }

    // Extract owner ID patterns (though we'll use userId automatically)
    const ownerPatterns = [
        /owner\s*id\s+(?:is|:)?\s+(\d+)/i,
        /id\s+(?:is|:)?\s+(\d+)/i
    ];

    for (const pattern of ownerPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            extracted.ownerId = match[1].trim();
            break;
        }
    }

    return extracted;
}

const chatbotController = async (req, res) => {
    try {
        // Handle both message and messgae typo in requests
        const message = req.body.message || req.body.messgae || '';
        const userId = req.body.userId;

        if (!userId) return res.status(400).json({ message: "User ID is required." });
        console.log("userId is present from request body", userId);

        let session = await getUserSession(userId);
        console.log("Current session:", session);

        // Auto-set ownerId to userId if not already set
        if (!session.ownerId) {
            session.ownerId = userId.toString();
            console.log("Auto-set ownerId to userId:", userId);
        }

        // First try direct extraction from the message
        const directExtracted = extractDirectInfo(message);
        let updatedDirectly = false;

        Object.entries(directExtracted).forEach(([key, value]) => {
            if (value && value !== "null" && value !== session[key]) {
                session[key] = value;
                if (session.askedParams) session.askedParams.delete(key);
                updatedDirectly = true;
            }
        });

        if (updatedDirectly) {
            console.log("Session updated with directly extracted values");
            await saveUserSession(userId, session);
        }

        // If direct extraction wasn't complete, try LLM extraction
        if (!updatedDirectly || ["name", "gitUrl", "description"].some(key => !session[key])) {
            // Enhanced extraction prompt
            const extractionPrompt = `
RETURN ONLY A JSON OBJECT WITH NO EXPLANATIONS OR ADDITIONAL TEXT

Analyze this message and extract project details:
Message: "${message}"

Extraction rules:
- If message contains phrases like "name is X", "project called X", extract X as the name
- If message contains a URL with github.com or gitlab.com, extract it as gitUrl
- If message explains what the project is or does, extract that content as description
- Treat any substantial explanation of project purpose as a description even without the word "description"
- If the user mentions what they are building/creating/developing, use that as the description
- If message contains "owner id" or similar, extract that number as ownerId
- For any missing or unclear values, return null

Current session values:
- Name: ${session.name}
- Git URL: ${session.gitUrl}
- Description: ${session.description}
- Owner ID: ${session.ownerId}

Return ONLY this JSON object:
{
    "name": "extracted value or null",
    "gitUrl": "extracted value or null", 
    "description": "extracted value or null",
    "ownerId": "extracted value or null"
}`;

            const extractedParams = await llm.predict(extractionPrompt);

            let userParams;
            try {
                const jsonStart = extractedParams.indexOf('{');
                const jsonEnd = extractedParams.lastIndexOf('}') + 1;

                if (jsonStart !== -1 && jsonEnd !== -1) {
                    const cleanJson = extractedParams.slice(jsonStart, jsonEnd);
                    userParams = JSON.parse(cleanJson);

                    // Fix common LLM issues where it returns the example text
                    Object.keys(userParams).forEach(key => {
                        if (userParams[key] === "extracted value or null" ||
                            userParams[key] === "extracted or null") {
                            userParams[key] = null;
                        }
                    });
                } else {
                    throw new Error("No JSON found in LLM response");
                }
            } catch (e) {
                console.error("JSON parsing error:", e);
                userParams = {
                    name: null,
                    gitUrl: null,
                    description: null,
                    ownerId: null
                };
            }

            console.log("Newly extracted params:", userParams);

            // Update session with new valid parameters
            let updatedValues = false;
            Object.entries(userParams).forEach(([key, value]) => {
                if (value && value !== "null" && value !== session[key]) {
                    session[key] = value;
                    if (session.askedParams) session.askedParams.delete(key);
                    updatedValues = true;
                }
            });

            if (updatedValues) {
                await saveUserSession(userId, session);
                console.log("Session updated with new values");
            }
        }

        // Enhanced missing parameters handling
        const missingParams = ["name", "gitUrl", "description"].filter(param => !session[param]);

        if (missingParams.length > 0) {
            const nextParam = missingParams.find(param => !session.askedParams.has(param));
            if (nextParam) {
                session.askedParams.add(nextParam);

                // Friendly parameter examples for guidance
                const paramExamples = {
                    name: "MyAwesomeProject",
                    gitUrl: "https://github.com/username/repository.git",
                    description: "A web application for managing tasks and tracking productivity"
                };

                // More specific instructions for certain parameters
                const paramInstructions = {
                    name: "Just tell me what you want to call your project",
                    gitUrl: "Share your GitHub repository URL where your code is stored",
                    description: "Tell me what your project does or what you're building - no need to say 'description is'"
                };

                // Enhanced AI prompt for missing values
                const promptTemplate = `
YOU ARE WRITING TEXT THAT WILL BE DISPLAYED DIRECTLY TO A USER.
DO NOT INCLUDE META TEXT LIKE "HERE'S A PROMPT" OR "I'LL ASK".
DO NOT USE MARKDOWN FORMATTING OR SECTION MARKERS.

Write a friendly, concise message asking for the user's project ${nextParam}.
Instructions: ${paramInstructions[nextParam]}
Include a clear example of what you're looking for.

Context: User has provided ${3 - missingParams.length}/3 details.
${Object.entries(session)
                        .filter(([key, value]) => value && ["name", "gitUrl", "description"].includes(key))
                        .map(([key, value]) => `${key}: ${value}`).join(", ")}

Example of what you're asking for: ${paramExamples[nextParam]}

YOUR RESPONSE:`;

                const prompt = await llm.predict(promptTemplate);
                const cleanedPrompt = cleanLLMResponse(prompt);
                await saveUserSession(userId, session);
                return res.json({ reply: cleanedPrompt });
            }
        }

        // Validate parameters
        const validationErrors = validateParams(session);
        if (validationErrors.length > 0) {
            return res.json({ reply: `Oops! Found some issues:\n- ${validationErrors.join("\n- ")}` });
        }

        // Add confirmation step
        if (!message.toLowerCase().includes('confirm') && !message.toLowerCase().includes('yes')) {
            const confirmationPrompt = `Great! I have all the details:
- Project Name: ${session.name}
- Description: ${session.description}
- Git URL: ${session.gitUrl}
- Owner ID: ${session.ownerId} (based on your user ID)

Please confirm if you want to proceed with the deployment (reply with 'yes' or 'confirm').`;

            await saveUserSession(userId, session);
            return res.json({ reply: confirmationPrompt });
        }

        // Store project in DB
        const createdProject = await prisma.project.create({
            data: { name: session.name, gitUrl: session.gitUrl, description: session.description, ownerId: parseInt(session.ownerId) },
        });

        console.log("project created");

        const createdDeployment = await prisma.deployment.create({
            data: { projectId: createdProject.id, status: "PENDING" },
        });

        console.log("deployment created");

        // Queue the deployment
        await buildQueue.add('deploy', {
            deploymentId: createdDeployment.id,
            gitUrl: session.gitUrl,
            projectId: createdProject.id
        });

        console.log("deployment updated by adding job");

        // Clear session after successful deployment
        await redis.del(`session:${userId}`);

        return res.json({ reply: `✅ Your project "${session.name}" has been successfully added to the build queue! 🎉` });

    } catch (error) {
        console.error("❌ Error:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

// Redis Helper Functions
const getUserSession = async (userId) => {
    const session = await redis.get(`session:${userId}`);
    if (session) {
        console.log("user identified through cache");
        const parsedSession = JSON.parse(session);
        // Ensure askedParams is an array before converting to Set
        parsedSession.askedParams = new Set(Array.isArray(parsedSession.askedParams) ? parsedSession.askedParams : []);
        return parsedSession;
    }
    return {
        name: null,
        gitUrl: null,
        description: null,
        ownerId: null,
        askedParams: new Set()
    };
};

const saveUserSession = async (userId, session) => {
    // Convert Set to Array for JSON serialization
    const sessionToSave = {
        ...session,
        askedParams: Array.from(session.askedParams)
    };
    await redis.set(`session:${userId}`, JSON.stringify(sessionToSave), "EX", 3600);
};

// Validate Inputs
const validateParams = (session) => {
    const errors = [];
    if (!session.name || session.name.length < 2) errors.push("Project name must be at least 2 characters.");
    if (!session.description || session.description.length < 5) errors.push("Project description must be at least 5 characters.");
    if (!session.ownerId || isNaN(parseInt(session.ownerId))) errors.push("Owner ID must be a valid number.");
    if (!session.gitUrl || !/^https?:\/\/github\.com\/[\w-]+\/[\w-]+(?:\.git)?$/i.test(session.gitUrl)) {
        errors.push("Git URL must be a valid GitHub repository.");
    }
    return errors;
};

module.exports = { chatbotController };

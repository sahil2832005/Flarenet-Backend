const bcrypt = require('bcrypt');
const { prisma } = require('../clients/prismaClient');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '../.env' });

/**
 * Validates password complexity
 * @param {string} password 
 * @returns {string|null} Error message or null if valid
 */
const validatePassword = (password) => {
    if (!password || password.length < 8) {
        return 'Password must be at least 8 characters';
    }
    if (!/[A-Z]/.test(password)) {
        return 'Password must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(password)) {
        return 'Password must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(password)) {
        return 'Password must contain at least one number';
    }
    return null;
};

/**
 * Validates email format
 * @param {string} email 
 * @returns {boolean}
 */
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const registerUser = async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        // Validate email format
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: "Invalid email format" });
        }

        // Validate password complexity
        const passwordError = validatePassword(password);
        if (passwordError) {
            return res.status(400).json({ error: passwordError });
        }

        // Check if user exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: "User already exists" });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const newUser = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
            },
        });

        return res.status(201).send({
            success: true,
            message: "User created successfully",
            data: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name
            }
        });
    }
    catch (err) {
        return res.status(500).send({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

const loginUser = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Find user by email
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, role: user.role,email: user.email},
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.status(200).json({ success: true, message: 'login successful', token });
    } catch (error) {
        res.status(500).send({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

module.exports = { registerUser, loginUser }



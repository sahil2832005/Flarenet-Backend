FROM node:20-slim

WORKDIR /usr/src/app

# Install OpenSSL, CA certificates and other required dependencies
RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with legacy peer deps and production flags
# Also install prisma CLI for schema generation
RUN npm install --legacy-peer-deps --production --no-audit && \
    npm install prisma@5.22.0 @prisma/client@5.22.0 --legacy-peer-deps --no-audit && \
    npm cache clean --force

# Copy prisma schema first
COPY prisma ./prisma/

# Generate Prisma client (using installed version)
RUN npx prisma generate

# Copy the rest of the application
COPY . .

# Expose the port your app runs on
EXPOSE 5000

# Start the application
CMD ["node", "index.js"]
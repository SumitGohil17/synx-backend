# Use Ubuntu as base image
FROM ubuntu:focal

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 18.x, npm, and FFmpeg
RUN apt-get update && \
    apt-get install -y curl && \
    curl -sL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Verify installations
RUN node --version && npm --version && ffmpeg -version

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma Client
RUN npx prisma generate

# Copy application code
COPY . .

# Create uploads directory for temporary files
RUN mkdir -p uploads

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "index.js"]

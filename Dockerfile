# 1) Build Docusaurus
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (cache-friendly)
COPY package*.json ./
RUN npm ci

# Copy the rest of the project and build
COPY . .
RUN npm run build

# 2) Serve the static build with a tiny HTTP server
FROM node:20-alpine AS runner

WORKDIR /app
RUN npm install -g serve

# Copy built site
COPY --from=builder /app/build ./build

EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]

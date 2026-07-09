# Step 1: Build Stage
# Changed from node:18-alpine to node:22-alpine
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Generate the Prisma client before building NestJS
RUN npx prisma generate
RUN npm run build

# Step 2: Production Stage
# Changed from node:18-alpine to node:22-alpine
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
# Updated to --omit=dev (modern equivalent of --only=production)
RUN npm install --omit=dev
RUN npx prisma generate
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/main"]
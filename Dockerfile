# Step 1: Build Stage
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Generate the Prisma client before building NestJS
RUN npx prisma generate
RUN npm run build

# Step 2: Production Stage
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
# Install only production dependencies and regenerate the client for the lightweight container
RUN npm install --only=production
RUN npx prisma generate
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/main"]
# Dockerfile

# ---- Stage 1: The Builder ----
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ---- Stage 2: The Production Image ----
FROM node:22-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

# Copy the built code and assets from the 'builder' stage
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/public ./public

# Command to run the bot
CMD [ "npm", "start" ]
FROM node:20-alpine

# better-sqlite3 needs build tools to compile native bindings
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Clean up build tools to keep image smaller
RUN apk del python3 make g++

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]

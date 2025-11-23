# Use official Node.js image as base
FROM node:16

# Set the working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY backend/package*.json ./
RUN npm install

# Copy the entire backend directory
COPY backend/ .

# Expose the port that the app will run on
EXPOSE 5000

# Start the Node.js server
CMD ["node", "server.js"]


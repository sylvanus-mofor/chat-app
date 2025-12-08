# File location: /home/chat-app/backend/Dockerfile

# Use the official Node.js image from Docker Hub
FROM node:16

# Set the working directory inside the container
WORKDIR /

# Copy package.json and package-lock.json first.
# MUST now reference the 'backend' folder, relative to the project root context.
COPY package.json ./

# Install the backend dependencies
RUN npm install

# Copy the rest of the backend application files
COPY . .

# Expose the port the backend will run on
EXPOSE 5000

# Run application
CMD ["npm", "start"]

# File location: /home/chat-app/frontend/Dockerfile

# Use an Nginx image to serve the static front-end files
FROM nginx:alpine

# Copy the static files into the container.
# This copies from the build context root's 'frontend' directory.
COPY . /usr/share/nginx/html

# CRITICAL: Copy the custom Nginx config file to override the default
COPY default.conf /etc/nginx/conf.d/default.conf

# Expose the default Nginx port
EXPOSE 80

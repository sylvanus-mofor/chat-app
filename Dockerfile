# Use an Nginx image to serve the static front-end files
FROM nginx:alpine

# Copy the static files into the container
COPY ./ /usr/share/nginx/html

# Expose the default Nginx port
EXPOSE 80


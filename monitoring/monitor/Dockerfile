# Use an official Node.js runtime as a parent image
FROM m.daocloud.io/docker.io/node:16

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code to the container
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Define environment variable if needed (e.g., custom Prometheus URL can be configured via ENV)
# ENV PROMETHEUS_BASE_URL=http://prometheus:9090

# Run the application
CMD [ "node", "server.js" ]


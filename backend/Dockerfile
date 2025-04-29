# Use an official Node.js runtime as a parent image
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json) to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Ensure the database directory exists and has correct permissions if needed
# RUN mkdir -p database && chown node:node database

# Expose the port the app runs on
EXPOSE 3001

# Define the command to run the application
CMD [ "npm", "start" ]


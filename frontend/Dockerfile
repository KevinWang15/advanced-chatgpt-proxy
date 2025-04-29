FROM node:20-alpine AS build

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
# Pass build-time environment variables if needed (e.g., for API URLs)
# ARG VITE_API_BASE_URL
# ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# ARG VITE_KEYCLOAK_AUTH_URL
# ENV VITE_KEYCLOAK_AUTH_URL=$VITE_KEYCLOAK_AUTH_URL
# ARG VITE_KEYCLOAK_REALM
# ENV VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM
# ARG VITE_KEYCLOAK_CLIENT_ID
# ENV VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID

CMD ["npm", "run", "dev"]

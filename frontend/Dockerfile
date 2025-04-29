# Stage 1: Build the React application
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
RUN npm run build

# Stage 2: Serve the static files using a lightweight server (e.g., Nginx)
FROM nginx:stable-alpine

# Copy the built application from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy the silent-check-sso.html file to the Nginx root
COPY --from=build /app/public/silent-check-sso.html /usr/share/nginx/html/silent-check-sso.html

# Copy a custom Nginx configuration if needed (e.g., to handle routing)
# COPY nginx.conf /etc/nginx/conf.d/default.conf
# Example nginx.conf to handle SPA routing:
# server {
#     listen 80;
#     server_name localhost;
# 
#     location / {
#         root /usr/share/nginx/html;
#         index index.html index.htm;
#         try_files $uri $uri/ /index.html;
#     }
# 
#     # Add other locations or configurations as needed
# }

# Expose port 80 (Nginx default)
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]


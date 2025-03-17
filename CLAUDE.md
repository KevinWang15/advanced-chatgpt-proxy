# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Overview

This project implements an advanced proxy system for ChatGPT that uses browser automation to simulate user interactions and avoid triggering mechanisms that detect proxies and cause degradation. The system consists of two main components:

1. **Central Server**:
   - Handles end user connections and authentication
   - Routes requests to available workers
   - Proxies the ChatGPT UI to end users
   - Manages account allocation and worker availability
   - Streams responses back to end users
   - Exposes `/metrics` endpoint for Prometheus monitoring

2. **Workers**:
   - Connect to the central server via WebSockets (Socket.IO)
   - Maintain active ChatGPT sessions
   - Execute tasks using browser automation
   - Can run on separate machines from the central server
   - Report status and availability to central server

3. **Chrome Extension**:
   - Injects into ChatGPT web interface
   - Connects to central server via WebSockets
   - Intercepts network traffic by hooking JavaScript's fetch API
   - Captures and forwards ChatGPT responses
   - Executes commands from central server

4. **MITM Proxy**:
   - Only modifies JavaScript files loaded from CDN
   - Does not intercept ChatGPT.com traffic (would trigger ja3 fingerprinting detection)
   - Injects custom code into ChatGPT's frontend JavaScript
   - Enables automation capabilities

## Commands Reference

### Running the Application

**Start Central Server:**
```bash
CONFIG=./config.centralserver.js node index.js
```

**Start Worker:**
```bash
CONFIG=./config.worker.js node index.js
```

### Prisma Database Commands

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations in development
npm run prisma:migrate

# Open Prisma Studio for DB visualization
npm run prisma:studio
```

### Monitoring Setup

```bash
# Start monitoring stack with Prometheus and Grafana
cd monitoring
docker-compose up -d
```

## Key Files

- **index.js**: Main entry point that determines if running as central server or worker
- **services/reverseproxy.js**: Handles HTTP proxying and request interception
- **services/launch_browser.js**: Manages browser automation with Chrome or AdsPower
- **services/mitmproxy.js**: Handles the MITM proxy functionality
- **services/auth.js**: Manages authentication and access control
- **state/state.js**: Maintains application state and data structures
- **degradation.js**: Implements degradation monitoring and tracking
- **chrome-extension/**: Contains the browser extension code

## Configuration

The system uses two main configuration files:

1. **config.centralserver.js**: 
   - Server port and host settings
   - Authentication passcode
   - Socket.IO configuration

2. **config.worker.js**:
   - Central server connection details
   - Account credentials (cookies, tokens)
   - Browser configuration (Chrome binary path or AdsPower API settings)
   - Proxy settings for accounts

## Database Schema

The system uses Prisma with a MySQL database to store:

- User tokens and access permissions
- Conversation data and metadata
- Account information and anonymization mappings
- Degradation check results
- Usage statistics
- Deep research tracking
- Gizmo (ChatGPT plugins) data

Make sure to set the `DATABASE_URL` environment variable before running any Prisma commands.

## Implementation Notes

1. The system supports two browser modes:
   - Regular Chrome/Chromium for single account testing
   - AdsPower Browser for multi-account setups (recommended for production)

2. Detection avoidance mechanisms:
   - MITM proxy only modifies JavaScript from CDNs, not direct ChatGPT traffic
   - Chrome extension intercepts network traffic via JavaScript hooks
   - Simulates natural user interaction patterns

3. Account isolation and management:
   - Each account runs in its own browser instance
   - System tracks account degradation and usage
   - Supports account switching via UI at `/accountswitcher/v2/`

4. Admin console (workers only):
   - Available when `adminConsole` is configured
   - Provides monitoring and management capabilities
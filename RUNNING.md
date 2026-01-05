# Running the Access Rewards Application

This guide explains how to run the Access Rewards application locally.

## Prerequisites

- Node.js >= 18.0.0
- npm (comes with Node.js)

## Quick Start

### Option 1: Using the run script (Recommended)

```bash
./run-app.sh
```

This script will:
- Install dependencies if needed
- Create a default `.env` file if it doesn't exist
- Start the application with the correct ports

### Option 2: Using npm directly

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory (see Configuration section below)

3. Start the application:
```bash
PORT=8080 BLOCKCHAIN_PORT=9000 npm start
```

## Configuration

The application requires a `.env` file. A default configuration will be created automatically if you use `run-app.sh`, or you can create it manually:

```env
# Database Configuration (placeholder for local development)
DATABASE_URL=postgresql://localhost:5432/access_network

# Application Configuration
PORT=8080
BLOCKCHAIN_PORT=9000
NODE_ENV=development

# VAPID Keys
VAPID_PUBLIC_KEY=BNj9ssedNiYUBqmqwJndFQHPZKBEWuFmtZYX9HBm0VdOgFWltE6jbgyIN1wfgSO-i_zoMq4Dmr7VBw3aQpx7cVI
VAPID_PRIVATE_KEY=cld4QfvBnKEksVSTcwKjDGghxLif3_QYBogorlrVBjk
VAPID_SUBJECT=mailto:admin@access-network.com

# Google OAuth
GOOGLE_CLIENT_ID=586936149662-ja0tlfjfinl2sl17j9ntp3m1avnf3dhn.apps.googleusercontent.com
```

## Accessing the Application

Once started, the application will be available at:

- **Web Interface**: http://localhost:8080
- **RPC Endpoint**: http://localhost:9000

![Access Rewards App Running](https://github.com/user-attachments/assets/2dea2dbe-7c72-44b1-ae7e-62888875e31c)

## Features

The application includes:
- Custom EVM-compatible blockchain (Chain ID: 22888)
- Web3 wallet integration
- ACCESS token rewards system
- Block explorer
- Smart contract support (ERC20/ERC721)
- Real-time WebSocket updates
- Google OAuth authentication

## Database Notes

The application is designed to work with PostgreSQL, but will gracefully handle database connection failures and continue running using LevelDB for blockchain state storage. Database errors for saving accounts and blocks are logged but don't prevent the application from functioning.

## Stopping the Application

Press `Ctrl+C` in the terminal where the application is running.

## Troubleshooting

### Port Already in Use

If you see an error like "EADDRINUSE", it means the port is already taken. You can:
1. Stop the process using that port
2. Use different ports by setting PORT and BLOCKCHAIN_PORT environment variables

### Dependencies Installation Issues

If `npm install` fails, try:
```bash
rm -rf node_modules package-lock.json
npm install
```

### Database Connection Errors

Database connection errors are expected if PostgreSQL is not running. The application will continue to function using LevelDB for blockchain storage.

## Development

The application uses:
- Node.js with ES Modules
- Express.js for the web server
- WebSocket for real-time communication
- LevelDB for blockchain state persistence
- PostgreSQL (optional) for user data

For more details, see the [replit.md](replit.md) file.

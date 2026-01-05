#!/bin/bash
# Simple script to run the Access Rewards application
#
# Usage: ./run-app.sh

echo "========================================"
echo "  Access Rewards Application Launcher  "
echo "========================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo ""
fi

# Check if .env exists
if [ ! -f ".env" ]; then
  echo "⚠️  No .env file found. Creating default configuration..."
  cat > .env << 'EOF'
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
EOF
  
  # Also copy to RealisticHonorableDeskscan directory
  cp .env Acces/RealisticHonorableDeskscan/.env
  echo "✅ Created .env file"
  echo ""
fi

echo "🚀 Starting Access Rewards application..."
echo ""
echo "Web Interface:  http://localhost:8080"
echo "RPC Endpoint:   http://localhost:9000"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the application
PORT=8080 BLOCKCHAIN_PORT=9000 npm start

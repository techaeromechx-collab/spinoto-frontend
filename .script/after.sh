#!/bin/bash
set -e

APP_DIR="/var/www/html/spinoto-frontend"
DEPLOY_DIR="/tmp/spinoto-frontend"

echo "============================================================"
echo "        SPINOTO FRONTEND DEPLOYMENT"
echo "============================================================"

export NVM_DIR="/home/ubuntu/.nvm"
source "$NVM_DIR/nvm.sh"

echo "Node:"
node -v

echo "NPM:"
npm -v

echo "Copying deployment files..."

rsync -a \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='dist' \
  "$DEPLOY_DIR/" "$APP_DIR/"
cd "$APP_DIR"

echo "Installing dependencies..."
npm install

echo "Building frontend..."
npm run build

if [ ! -f "$APP_DIR/dist/index.html" ]; then
    echo "ERROR: dist/index.html not found"
    exit 1
fi

echo "Frontend deployment completed successfully."

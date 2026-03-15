#!/usr/bin/env bash
set -euo pipefail

HOST="plan.hikingmap.org"
REMOTE_DIR="~/outdoor-trip-planner"

echo "Deploying to $HOST..."

ssh "$HOST" bash <<EOF
  set -euo pipefail
  cd $REMOTE_DIR

  echo "Pulling latest changes..."
  git pull

  echo "Building and restarting containers..."
  docker compose -f docker-compose.prod.yml up --build -d

  echo "Removing unused images..."
  docker image prune -f

  echo "Deploy complete."
EOF

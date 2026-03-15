#!/usr/bin/env bash
set -euo pipefail

HOST="plan.hikingmap.org"
REMOTE_DIR="~/outdoor-trip-planner"
BRANCH="master"

echo "Deploying to $HOST..."

echo "Checking that local $BRANCH is pushed to origin..."
git fetch origin
if [[ -n "$(git rev-list "origin/$BRANCH..$BRANCH" 2>/dev/null)" ]]; then
  echo "Error: Local $BRANCH has commits not pushed to origin. Push first, then deploy."
  exit 1
fi

ssh "$HOST" bash <<EOF
  set -euo pipefail
  cd $REMOTE_DIR

  echo "Pulling latest changes..."
  git pull

  echo "Building and restarting containers..."
  docker compose -f docker-compose.prod.yml up --build -d

  echo "Running migrations..."
  docker compose -f docker-compose.prod.yml exec -T api python manage.py migrate --no-input

  echo "Removing unused images..."
  docker image prune -f

  echo "Deploy complete."
EOF

# Outdoor Trip Planner

A full-stack web application for planning outdoor trips and hikes. Pin locations on an interactive map, plan hike routes with elevation profiles, and explore how far you can travel by public transit from any point. An AI assistant helps you discover and add points of interest hands-free.

Built with Django + Django REST Framework (backend) and Angular + Angular Material (frontend).

## Features

- **Interactive map** — pan, zoom, and click to explore terrain using Leaflet with multiple tile layers
- **Locations** — save and categorise points of interest (peaks, huts, campsites, villages, viewpoints, trails, and more) with optional descriptions and links; metadata is auto-enriched on save
- **Hike route planning** — draw multi-waypoint routes on the map with turn-by-turn directions, distance, ascent/descent stats, and an interactive elevation profile
- **Hike isochrones** — visualise how far you can walk from any location within 1 or 2 hours
- **Public-transit reachability** — colour-coded overlay showing every transit stop reachable within 15–60 minutes from a chosen point, powered by [Transitous](https://transitous.org)
- **Elevation contour lines** — toggleable contour overlays at 1 500 m, 1 750 m, 2 000 m, 2 500 m, and 3 000 m
- **Location search / geocoding** — search for places by name and jump directly to them on the map
- **AI chat assistant** — conversational assistant that can suggest locations, add them to the map, and answer questions about the current view; supports streaming responses
- **Shareable trip maps** — each trip lives under a unique URL that can be shared with others

## Backend Setup

### Requirements

- Python 3.12
- `virtualenv`

### Steps

```bash
# Create and activate virtual environment
virtualenv --python=python3.12 env
source env/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy local settings and configure
cp config/settings_local.py.example config/settings_local.py
# Edit config/settings_local.py and set DEBUG, SECRET_KEY, etc.

# Run migrations
python manage.py migrate

# Start development server
python manage.py runserver
```

The API will be available at `http://localhost:8000/api/`.

Health check: `GET http://localhost:8000/api/health/`

## Frontend Setup

### Requirements

- Node.js (v18+)
- npm

### Steps

```bash
cd client

# Install dependencies
npm install

# Start development server (proxies /api to Django on port 8000)
npm start
```

The Angular app will be available at `http://localhost:4200`.

## Development

Run both servers simultaneously:

1. Backend: `python manage.py runserver`
2. Frontend: `cd client && npm start`

The Angular dev server proxies all `/api` requests to `http://localhost:8000`, so there are no CORS issues during development.

## License

MIT — see [LICENSE](LICENSE).

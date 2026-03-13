# Outdoor Trip Planner

A full-stack web application built with Django + Django REST Framework (backend) and Angular + Angular Material (frontend).

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

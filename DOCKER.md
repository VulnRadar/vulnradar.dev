# Docker Setup for VulnRadar

This guide explains how to run VulnRadar using Docker and Docker Compose.

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- (Optional) A `.env` file with configuration (see `.env.example`)

### Run with Docker Compose

```bash
# Start all services (PostgreSQL + VulnRadar app)
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

The app will be available at `http://localhost:3000`

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` - Database credentials
- `NEXT_PUBLIC_APP_URL` - Public app URL
- `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` - Cloudflare CAPTCHA keys
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` - Email configuration
- `CONTACT_EMAIL` - Contact form recipient email

### Database

PostgreSQL runs on port `5432` (customizable via `DB_PORT` env var). The database is persisted in a Docker volume.

To reset the database:

```bash
docker-compose down -v
docker-compose up -d
```

## Building the Docker Image

If you want to build the image manually:

```bash
docker build -t vulnradar:latest .
```

Then run it with custom networking and a database:

```bash
docker run -d \
  --name vulnradar \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  vulnradar:latest
```

## Production Deployment

For production:

1. **Use a managed database** - Don't use the Docker Compose PostgreSQL service in production. Use AWS RDS, Supabase, or similar.
2. **Set strong passwords** - Change `POSTGRES_PASSWORD` and other secrets in `.env`
3. **Configure HTTPS** - Place behind a reverse proxy (nginx, Traefik, etc.)
4. **Set proper URLs** - Update `NEXT_PUBLIC_APP_URL` to your domain
5. **Enable backups** - If using Docker volumes, ensure regular backups

Example production docker-compose:

```yaml
# Only the app service, no PostgreSQL
services:
  app:
    build: .
    environment:
      DATABASE_URL: postgresql://user:pass@your-managed-db:5432/vulnradar
      NEXT_PUBLIC_APP_URL: https://yourdomain.com
    ports:
      - "3000:3000"
```

## Troubleshooting

### Port already in use
Change ports in `.env`:
```
APP_PORT=8080
DB_PORT=5433
```

### Database connection refused
Ensure PostgreSQL is healthy:
```bash
docker-compose ps
docker-compose logs postgres
```

### App won't start
Check logs and migrations:
```bash
docker-compose logs app
```

The `pnpm migrate` command runs on startup. If it fails, the app won't start.

## Development

For local development without Docker:

```bash
pnpm install
pnpm migrate
pnpm dev
```

Requires PostgreSQL running locally with proper `DATABASE_URL` set.

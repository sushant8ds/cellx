# Universal Dynamic Data & Calibration Platform

## Quick Start

### Prerequisites
- Node.js 20+
- Docker Desktop (for PostgreSQL + Redis)

---

### Step 1 — Install dependencies

```bash
npm install
```

---

### Step 2 — Start the database

```bash
docker-compose up -d
```

This starts PostgreSQL on port 5432 and Redis on port 6379.

---

### Step 3 — Run database migrations

```bash
npm run migrate --workspace=packages/api
```

---

### Step 4 — Start the API server

```bash
npm run dev --workspace=packages/api
```

API runs at: http://localhost:3000
Health check: http://localhost:3000/health

---

### Step 5 — Start the frontend

Open a new terminal:

```bash
npm run dev --workspace=packages/web
```

Frontend runs at: http://localhost:5173

---

### Step 6 — Create your first tenant and admin user

```bash
# Create a tenant
curl -X POST http://localhost:3000/tenants \
  -H "Content-Type: application/json" \
  -d '{"name": "My Company", "slug": "my-company"}'

# Create an admin user (replace TENANT_ID with the id from above)
curl -X POST http://localhost:3000/tenants/TENANT_ID/users \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@mycompany.com", "password": "yourpassword", "role": "admin"}'
```

Then open http://localhost:5173, enter your tenant slug, email, and password.

---

### Run tests

```bash
npm test --workspace=packages/api
npm test --workspace=packages/web
```

---

### Environment variables

Copy `packages/api/.env` and update:
- `JWT_SECRET` — use a long random string in production
- `OPENAI_API_KEY` — required for the AI Assistant feature
- `DATABASE_URL` — update if using a remote database

---

### Architecture

```
packages/
  api/     — Node.js + Express + TypeScript backend
  web/     — React + TypeScript + Vite frontend
```

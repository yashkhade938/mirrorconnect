# MirrorConnect Monitoring & Telemetry Manual

MirrorConnect exposes production HTTP monitoring endpoints and operational telemetry metrics for health tracking and uptime monitoring.

---

## 1. HTTP Monitoring Endpoints

### `GET /health`
Returns 200 OK when service and PostgreSQL database are healthy. Returns 503 Service Unavailable if database connection fails.

**Sample Payload**:
```json
{
  "status": "ok",
  "service": "mirrorconnect-backend",
  "database": "connected",
  "uptimeSeconds": 86420,
  "connectedSockets": 12,
  "memory": {
    "rssMb": 64,
    "heapTotalMb": 42,
    "heapUsedMb": 28
  }
}
```

### `GET /ready`
Readiness probe for load balancers and orchestrators.
```json
{ "ready": true, "service": "mirrorconnect-backend" }
```

### `GET /version`
Build and version metadata.
```json
{
  "name": "@mirrorconnect/backend",
  "version": "1.0.0",
  "nodeEnv": "production",
  "nodeVersion": "v22.14.0"
}
```

---

## 2. Docker Container Health Checks

Every service in `docker-compose.yml` includes an automated health check:

- **PostgreSQL**: `pg_isready -U mirrorconnect -d mirrorconnect`
- **Backend**: `fetch('http://localhost:4000/health')`
- **Frontend**: `fetch('http://localhost:3000')`
- **Nginx**: `wget http://localhost/health`
- **Coturn**: `turnutils_uclient` check on port 3478

---

## 3. Log Inspection Commands

View real-time logs across containers:

```bash
# View backend logs with timestamps
docker compose logs -f --tail=100 backend

# View Nginx access & error logs
docker compose logs -f --tail=100 nginx

# View Coturn TURN server relay logs
docker compose logs -f --tail=100 coturn
```

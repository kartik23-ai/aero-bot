# Deployment Guide

## Local

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8080`.

## Production Plan

1. Register the bot with Aero Messenger using official APIs only.
2. Configure OAuth redirect URLs and webhook URLs.
3. Deploy API containers to Kubernetes, ECS, Cloud Run, or App Service.
4. Use managed PostgreSQL with point-in-time recovery.
5. Use managed Redis for cache and rate limiting.
6. Deploy queue workers separately from API pods.
7. Store secrets in the cloud secret manager, never in Git.
8. Enable TLS, WAF, rate limits, and webhook signature validation.
9. Configure structured log shipping and alerts.
10. Run smoke tests against `/api/health`, webhook delivery, dashboard, and export endpoints.

## Deployment Options

- Docker: use `Dockerfile` for a single API container.
- Docker Compose: use `docker-compose.yml` for API, PostgreSQL, Redis, Elasticsearch, Prometheus, and Grafana.
- Kubernetes: use manifests in `k8s/` for API replicas, workers, services, and autoscaling.

## CI/CD

The included GitHub Actions workflow runs tests on push and pull requests. Production pipelines should add:

- container image build and scan
- SAST and dependency scanning
- database migration dry run
- deployment approval gates
- canary rollout
- automatic rollback on health check failure

## Monitoring

Track:

- API latency and error rate
- webhook success/failure count
- queue depth and retry count
- AI token spend and failure rate
- moderation action volume
- database CPU, connections, locks, and storage

## Backup

- PostgreSQL: continuous WAL archiving and daily snapshots.
- Object storage exports: encrypted, lifecycle-managed retention.
- Configuration: versioned and backed up through IaC.
- Restore drills: at least monthly.

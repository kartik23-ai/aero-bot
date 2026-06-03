# Scaling Guide

## Small Scale: 1-50 Groups

- Server: 2 CPU, 4 GB RAM.
- One API container and one worker container.
- Managed PostgreSQL with automated backups.
- Managed Redis or single Redis container.

## Medium Scale: 50-500 Groups

- Server: 4 CPU, 8-16 GB RAM.
- 2-4 API replicas behind a load balancer.
- 2+ worker replicas for summaries, scheduled messages, and exports.
- PostgreSQL read replica for analytics-heavy queries.
- Redis with persistence and monitoring.

## Large Scale: 500+ Groups

- Kubernetes cluster with multiple nodes.
- HorizontalPodAutoscaler for API and workers.
- Dedicated queue workers by job type.
- PostgreSQL partitioning for messages and audit logs.
- Elasticsearch for logs and message search.
- S3-compatible storage for exports and attachments.
- Prometheus and Grafana for monitoring.

## Database Optimization

- Partition `messages`, `audit_logs`, and `moderation_actions` by month at high volume.
- Keep hot dashboard queries backed by materialized views or rollup tables.
- Use indexes on `(group_id, created_at)`, report status, command names, and audit timestamps.
- Archive old raw chat data according to retention policy.

## Queue Strategy

Use BullMQ for:

- weekly summaries
- scheduled messages
- broadcast fanout
- export jobs
- AI requests
- webhook retries

Workers must be idempotent and retry with exponential backoff.

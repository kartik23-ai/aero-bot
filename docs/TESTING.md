# Testing Guide

## Automated Tests

```bash
npm test
```

Current tests cover command permissions, moderation fallbacks, welcome flow, keyword triggers, private-message ignoring, and summaries.

## Production Test Matrix

- Unit tests for command parsing, RBAC, i18n, summaries, and AI routing.
- Integration tests for Aero webhook handling and official API adapters.
- Contract tests for dashboard API responses.
- Load tests for webhook throughput and rate limiting.
- Security tests for auth, audit logging, input validation, and export permissions.
- Disaster recovery tests for database restore and webhook re-registration.

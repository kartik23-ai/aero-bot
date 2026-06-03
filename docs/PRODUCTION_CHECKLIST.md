# Production Checklist

## Pre-Launch

- Aero Messenger app approved and OAuth configured.
- Webhook endpoint registered with signature secret.
- PostgreSQL migrations applied.
- Redis configured.
- Queue workers deployed.
- Secrets stored in secret manager.
- Dashboard protected by OAuth.
- RBAC verified for Owner, Admin, and User.
- Manual Control Center restricted to Owner/Admin.
- Every manual action creates an audit log.
- Custom commands reviewed and scoped by group.
- Automation Builder has approval and rollback process.
- Rate limiting enabled.
- Audit logs enabled.
- Monitoring dashboards and alerts configured.
- Backup and restore verified.

## Launch

- Deploy canary release.
- Verify `/api/health`.
- Send test webhook.
- Run moderation command smoke tests.
- Run report and summary smoke tests.
- Confirm dashboard metrics update.
- Confirm CSV and Excel exports.
- Monitor error rate and queue depth.

## Post-Launch

- Review audit logs daily for first week.
- Review AI responses and summary quality.
- Tune rate limits.
- Add platform API retry policies.
- Schedule monthly restore drills.

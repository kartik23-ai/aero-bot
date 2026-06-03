# Security Guide

## Required Controls

- Use only official Aero Messenger APIs and platform-approved integrations.
- Never use stolen cookies, browser hijacking, session theft, unauthorized scraping, or reverse engineering.
- OAuth for owner/admin dashboard authentication.
- Encrypt access and refresh tokens before storage.
- RBAC for Owner, Admin, and User actions.
- Webhook signature validation.
- Per-IP and per-group rate limiting.
- Input validation and output escaping.
- Audit logs for auth, config, moderation, exports, and AI settings.
- Principle of least privilege for database and cloud IAM.
- Manual actions require Owner/Admin role and are logged with actor, timestamp, affected group, input, and result.
- Bulk actions such as mention everyone and broadcast should require Owner approval or a stricter permission flag.
- Automation rules must be validated before activation.

## Role Matrix

| Capability | Owner | Admin | User |
|---|---:|---:|---:|
| Configure bot | Yes | No | No |
| Manage admins | Yes | No | No |
| Configure AI | Yes | No | No |
| Manage groups | Yes | Limited | No |
| Kick/ban/mute/warn | Yes | Yes | No |
| View reports | Yes | Yes | No |
| Generate summaries | Yes | Yes | Request only |
| Use AI assistant | Yes | Yes | Yes |
| Export data | Yes | No | No |
| Reset settings | Yes | No | No |

## Data Privacy

Summaries should only use group-visible content and should not expose private or sensitive content beyond the requester’s permission level.

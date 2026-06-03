# Installation Guide

## Group Installation Flow

1. Owner creates a bot account in Aero Messenger.
2. Owner opens the AeroGroupGuard dashboard.
3. Owner connects the Aero account through official OAuth authentication.
4. Owner selects groups from the official API group picker.
5. Owner grants permissions for moderation, messages, webhooks, and group metadata.
6. Bot token and webhook secret are stored encrypted.
7. Bot becomes active.
8. Dashboard displays connected groups and live health.



## Production Setup

```bash
cp .env.example .env
docker compose up --build
```

Then configure real production secrets in your cloud secret manager.

## Assistant-Only Setup Without Moderation

If you only want welcome, FAQ, info, report, rules, and mention replies:

1. Create a normal Aero account for the bot identity.
2. Add that bot account to your Aero group.
3. Keep destructive permissions disabled.
4. Enable Automated Assistant Mode in the dashboard.
5. Connect only an official or platform-approved source that can send group events to `/api/webhooks/aero`.
6. Connect an approved sender channel for outbound messages.

The system will not use hidden browser sessions, stolen cookies, unauthorized scraping, or Android accessibility bypasses.

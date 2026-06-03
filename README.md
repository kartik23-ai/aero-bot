---
title: AeroGroupGuard
emoji: 🛡️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# AeroGroupGuard Production Bot

AeroGroupGuard is a production-oriented Aero Messenger group management and AI assistant bot scaffold.

It implements:

- OWNER, ADMIN, and USER permission levels
- Admin-only moderation commands
- User help, rules, report, status, and info commands
- Keyword triggers for report/admin/rules/moderation help
- Welcome messages for new members
- Short 7-day chat summaries for OWNER and ADMIN
- Multi-language detection and localized responses
- AI assistant routing for rules, help, FAQs, and admin assistance
- Analytics API and professional dashboard
- Owner, admin, and user portal sections
- Automated Assistant Mode for welcome replies, mention activation, FAQs, info, rules, reports, and safe summaries
- Manual Control Center for broadcasts, schedules, templates, AI commands, live group controls, custom commands, and automations
- Docker, CI, schema, and production runbooks
- Internal action logging
- Platform action fallbacks when kick, ban, mute, or unmute are unavailable

## Run

```bash
npm test
npm start
```

Open `http://localhost:8080` for the dashboard.

## Automated Assistant Mode

When an official or platform-approved Aero event source posts group events to `/api/webhooks/aero`, the bot automatically:

- welcomes new members
- responds to `@AeroGroupGuard help`
- responds to `@AeroGroupGuard faq`
- responds to `/rules`, `/info`, `/report`, `/status`, and user help commands
- queues safe replies for automatic sending through an approved sender connector

Destructive actions such as kick, ban, mute, purge, lock, unlock, and slow mode are disabled in assistant mode.

## Usage

```js
const { AeroGroupGuard } = require("./src/aero-group-guard");

const bot = new AeroGroupGuard({
  ownerId: "owner-123",
  botMention: "@AeroGroupGuard"
});

const reply = bot.handleMessage(
  {
    text: "/mute @sam 10m spam",
    sender: { id: "admin-1", isPlatformAdmin: true }
  },
  {
    enabled: true,
    isGroup: true,
    groupName: "Flight Crew",
    platformActions: {
      mute: ({ target, reason }) => {
        // Call the chat platform moderation API here.
      }
    }
  }
);

console.log(reply);
```

## Commands

User commands:

- `/help`
- `/rules`
- `/report [message or reason]`
- `/admin`
- `/info`
- `/tagbot [question]`
- `/status`
- `/commands`

Admin commands:

- `/kick @user [reason]`
- `/ban @user [reason]`
- `/mute @user [duration] [reason]`
- `/unmute @user`
- `/warn @user [reason]`
- `/clearwarns @user`
- `/lock`
- `/unlock`
- `/setwelcome on|off`
- `/setrules [text]`
- `/setprefix [symbol]`
- `/slowmode [seconds]`
- `/purge [count]`
- `/reportreview [reportId]`
- `/summary`
- `/weeklysummary`
- `/recap`

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API Specification](docs/API.md)
- [Database Design](docs/DATABASE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Installation Guide](docs/INSTALLATION.md)
- [Bot Management Portal](docs/BOT_MANAGEMENT_PORTAL.md)
- [Scaling Guide](docs/SCALING.md)
- [Security Guide](docs/SECURITY.md)
- [Testing Guide](docs/TESTING.md)
- [Production Checklist](docs/PRODUCTION_CHECKLIST.md)

# API Specification

Base URL: `/api`

## Health

`GET /health`

Returns service status and dependency checks.

## Dashboard

`GET /dashboard`

Returns metrics, groups, recent reports, and system health.

`GET /portal`

Returns owner, admin, and user portal capabilities, admin assignments, subscription status, AI settings, and installation steps.

`GET /install-flow`

Returns the official group connection flow and supported installation methods.

## Groups

`GET /groups`

Returns managed Aero Messenger groups.

## Reports

`GET /reports`

Returns report list.

`POST /reports/export`

Returns CSV export. Use the dashboard Excel export for spreadsheet-compatible output.

`GET /audit-logs`

Returns recent manual action and configuration audit events.

## Commands

`GET /commands`

Returns supported user, admin, and owner commands.

## Aero Webhook

`POST /webhooks/aero`

Body:

```json
{
  "eventType": "message",
  "groupId": "aero-group-id",
  "groupName": "Aero Community",
  "text": "@AeroGroupGuard faq",
  "sender": { "id": "aero-user-id", "isPlatformAdmin": false },
  "adminIds": ["aero-admin-id"],
  "language": "en",
  "chatHistory": []
}
```

Response:

```json
{
  "eventType": "message",
  "reply": "FAQ: Use /rules...",
  "sendAction": {
    "status": "queued_for_auto_send",
    "reason": "assistant_reply"
  }
}
```

For welcome automation, send `eventType: "member_join"` with a `member` object.

`GET /assistant-mode`

Returns assistant-mode status, allowed auto replies, blocked destructive actions, and latest queued outbound replies.

## AI

`POST /ai/ask`

Body:

```json
{ "question": "@bot explain rules", "role": "USER", "language": "en" }
```

Response:

```json
{ "answer": "Rules: Be respectful...", "model": "gpt-4.1-mini" }
```

## Manual Control Center

`GET /manual-control`

Returns templates, custom commands, automations, scheduled messages, quick actions, and live controls.

`POST /manual/messages/preview`

```json
{ "groupIds": ["group-1"], "message": "Maintenance starts at 8 PM." }
```

`POST /manual/messages/send`

```json
{
  "actor": { "id": "owner-1", "role": "OWNER" },
  "groupIds": ["group-1", "group-2"],
  "message": "Community update"
}
```

`POST /manual/messages/schedule`

```json
{
  "actor": { "id": "admin-1", "role": "ADMIN" },
  "groupIds": ["group-1"],
  "message": "Event reminder",
  "runAt": "2026-06-07T14:30:00.000Z"
}
```

`POST /manual/console`

```json
{
  "actor": { "id": "admin-1", "role": "ADMIN" },
  "instruction": "Show unresolved reports",
  "groupIds": ["group-1"]
}
```

`POST /manual/groups/action`

Allowed actions: `send_message`, `mention_everyone`, `lock`, `unlock`, `slowmode_on`, `slowmode_off`, `summary`, `export_chat`, `review_reports`, `view_logs`.

`POST /custom-commands`

Owner-only endpoint for no-code commands such as `/event`, `/apply`, `/contact`, and `/about`.

`POST /automations`

Owner-only endpoint for visual automation rules.

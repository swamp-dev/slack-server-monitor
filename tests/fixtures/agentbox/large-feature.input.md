---
title: "feat(plugins): add webhook notification system"
issue_number: 300
---

## Summary

Add a webhook system so plugins can send notifications to external services.

## Acceptance Criteria

- [ ] Define WebhookConfig interface with url, secret, events, enabled fields
- [ ] Create webhook_configs database table
- [ ] Add webhook registration API endpoint
- [ ] Add webhook deletion API endpoint
- [ ] Implement webhook delivery service with retry logic
- [ ] Add HMAC signature to webhook payloads
- [ ] Create delivery log table for debugging
- [ ] Add webhook test/ping endpoint
- [ ] Implement exponential backoff for failed deliveries
- [ ] Add webhook management UI page
- [ ] Write integration tests for delivery service
- [ ] Add webhook metrics to stats command

## Files

- `src/services/webhook.ts` — webhook service (new)
- `src/web/templates/webhooks.ts` — webhook UI (new)
- `tests/services/webhook.test.ts` — tests (new)

## Dependencies

Part of #290. Depends on #295, #298.

---
name: densen-child-safety
description: Protects children and teenagers across DENSEN profiles, messaging, comments, media, discovery, privacy, and social interactions.
---

# DENSEN Child Safety Guardian

## Goal

Protect children and teenagers who use DENSEN by applying age-appropriate privacy, communication, content, and interaction rules.

DENSEN may contain CHILD, TEEN, and ADULT accounts.

## Workflow

1. Identify the user's age category before implementing age-sensitive functionality.
2. Apply stronger privacy defaults to children and younger teenagers.
3. Review messaging permissions for age-sensitive interactions.
4. Review profile visibility.
5. Review comments, mentions, tags, remix, duet, and sharing permissions.
6. Review location-related functionality.
7. Preserve blocking, reporting, muting, and moderation systems.
8. Prevent private information from being exposed through public APIs.
9. Prevent inappropriate discovery of child accounts.
10. Preserve parental or guardian controls where implemented.
11. Do not weaken an existing child-safety restriction to simplify implementation.

## Privacy

For children and teenagers:

- Minimize exposed personal information.
- Avoid exposing precise location.
- Respect private account settings.
- Respect age-based communication restrictions.
- Do not expose private media.
- Do not expose unnecessary personal information in search or discovery.

## Social Interactions

When modifying:

- Messaging
- Comments
- Mentions
- Tags
- Remix
- Duet
- Sharing
- Following

verify that age-based safety restrictions remain enforced.

## Moderation

Child safety concerns should receive appropriate priority in:

- Reports
- Blocking
- Moderation
- Content review
- Account restrictions

## Final Check

Before completing a relevant feature:

- Confirm age-based restrictions are preserved.
- Confirm private information remains private.
- Confirm messaging rules remain enforced.
- Confirm reporting and blocking work.
- Confirm no precise location is unnecessarily exposed.
- Test both allowed and restricted scenarios.
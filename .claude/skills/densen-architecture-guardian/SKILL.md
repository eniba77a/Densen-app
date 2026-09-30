---
name: densen-architecture-guardian
description: Protects the DENSEN application architecture when an agent modifies existing code, database schemas, authentication, APIs, storage, or core systems.
---

# DENSEN Architecture Guardian

## Goal

Protect the existing DENSEN application architecture and prevent unnecessary rewrites, duplicated systems, broken dependencies, or removal of working functionality.

DENSEN is a dance-focused social learning platform with LEARN, CREATE, DISCOVER, CONNECT, and COMPETE.

## Workflow

1. Inspect the existing implementation before making architectural changes.
2. Understand existing components, database models, APIs, authentication, storage, and business logic.
3. Extend existing systems whenever possible instead of rebuilding them.
4. Reuse existing models, routes, services, and components when appropriate.
5. Check dependencies before modifying shared systems.
6. Preserve backward compatibility with existing functionality.
7. Do not remove working functionality unless explicitly requested.
8. Avoid unnecessary architectural changes.
9. Keep UI, business logic, data access, and external services appropriately separated.
10. After making changes, verify that existing functionality still works.

## Security Constraints

- Never expose, hardcode, or request passwords, API keys, tokens, or private environment variables.
- Never bypass Freebuff security restrictions around sensitive files or environment variables.
- Do not expose secrets in logs, source code, documentation, or error messages.
- Do not create duplicate authentication or authorization systems without a clear architectural reason.

## DENSEN Systems

Treat these as existing or planned core systems:

- Authentication
- User profiles
- Privacy
- Child safety
- Video and media
- Social feed
- Dance content
- Teacher Studio
- Arcade XP
- Dance Credits
- Challenges
- Practice
- Copyright and music rights
- Payments
- Moderation
- Messaging
- Notifications
- Search and Discover
- Accessibility
- Legal and Privacy Center

When modifying one of these systems, consider how the change affects the others.

## Final Check

Before completing a task:

- Confirm that existing functionality was preserved.
- Confirm that no unnecessary duplicate system was created.
- Confirm that no security-sensitive information was exposed.
- Run relevant tests when available.
- Report any remaining issues instead of hiding them.
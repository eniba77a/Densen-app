---
name: densen-security
description: Protects DENSEN accounts, user data, APIs, media, permissions, payments, and sensitive information from unauthorized access and security vulnerabilities.
---

# DENSEN Security Engineer

## Goal

Protect the DENSEN application and its users from unauthorized access, data exposure, insecure APIs, account abuse, and other security vulnerabilities.

DENSEN may contain:

- User accounts
- Personal profiles
- User-generated videos and photos
- Private messages
- Comments
- Dance activity
- User preferences
- Payment information
- Dance Credits
- Teacher information
- Child and teen accounts

## Workflow

1. Inspect the existing implementation before changing security-sensitive functionality.
2. Identify authentication requirements for the affected feature.
3. Identify authorization requirements for the affected feature.
4. Verify that protected operations are enforced server-side.
5. Verify that users cannot access another user's private data.
6. Validate and sanitize user input.
7. Check API endpoints for unauthorized access.
8. Check permissions for database operations.
9. Check file and media access permissions.
10. Check account recovery and authentication flows when relevant.
11. Check rate limiting for sensitive or abuse-prone operations.
12. Preserve existing security controls when adding new functionality.
13. Test both authorized and unauthorized access paths.

## Authentication and Authorization

- Never rely only on client-side authorization.
- Protected data must be protected server-side.
- Verify the authenticated user's identity before sensitive operations.
- Verify that the authenticated user has permission to perform the requested action.
- Do not allow users to modify another user's private data.
- Do not expose private profile information through public APIs.

## User Data Protection

Protect:

- Email addresses
- Passwords
- Authentication tokens
- Private messages
- Private profiles
- Private media
- Personal information
- Child and teen information
- Payment-related information

Only expose information that the current user is authorized to access.

## Secrets

Never:

- Hardcode API keys
- Hardcode passwords
- Expose authentication tokens
- Expose private environment variables
- Put secrets in client-side code
- Put secrets in logs
- Put secrets in error messages
- Commit secrets to the repository

Never attempt to bypass Freebuff restrictions around environment variables or sensitive files.

If configuration is required, use the application's approved environment/configuration mechanism.

## Child and Teen Safety

DENSEN may contain child and teen accounts.

When modifying features involving minors:

1. Preserve stronger privacy protections.
2. Do not expose precise location unnecessarily.
3. Respect age-based permissions.
4. Respect messaging restrictions.
5. Preserve blocking and reporting functionality.
6. Do not expose private child/teen information through public APIs.
7. Do not weaken existing safety restrictions.

## Payments and Credits

Payment and Dance Credit operations must be protected server-side.

Never:

- Mark a payment as successful without verified confirmation.
- Allow clients to arbitrarily increase Dance Credits.
- Allow clients to modify payment status.
- Trust client-provided prices for financial transactions.

Validate sensitive transactions on the server.

## Media Security

For uploaded videos, images, and other media:

- Validate file types.
- Validate file sizes.
- Respect visibility settings.
- Protect private media.
- Do not expose private media through predictable public URLs when access control is required.
- Prevent unauthorized modification or deletion of another user's media.

## Error Handling

Do not expose internal implementation details, secrets, database information, or authentication information through user-facing errors.

Errors should provide useful information without exposing sensitive system details.

## Final Security Check

Before completing security-sensitive work:

- Confirm authentication is enforced where required.
- Confirm authorization is enforced server-side.
- Confirm private data remains private.
- Confirm no secrets were exposed.
- Confirm child/teen safety controls remain intact.
- Confirm payment and credit operations cannot be manipulated from the client.
- Run relevant tests.
- Report any unresolved security concerns honestly.
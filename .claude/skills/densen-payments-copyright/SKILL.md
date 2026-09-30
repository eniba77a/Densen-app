---
name: densen-payments-copyright
description: Protects DENSEN payment, Dance Credits, purchasing, refunds, music rights, copyright, claims, and licensing workflows from fake or insecure implementations.
---

# DENSEN Payments and Copyright Guardian

## Goal

Ensure that payment and copyright functionality is implemented realistically, securely, and without fake success states or unsupported legal assumptions.

# Payments

DENSEN may offer paid dance content with configurable prices, including approximately €2–€30.

## Payment States

Use clear payment states such as:

- PENDING
- PAID
- FAILED
- REFUNDED
- CANCELLED

## Payment Rules

Never:

- Pretend a payment succeeded.
- Mark an order as paid without verified provider confirmation.
- Trust a client-provided payment status.
- Trust a client-provided price for a financial transaction.
- Expose payment secrets.
- Store sensitive payment information unnecessarily.
- Create fake payment provider responses.

Payment confirmation must be verified server-side.

## Dance Credits

Dance Credits are application reward credits.

They are not a financial credit score.

Credit operations must be protected server-side.

Never allow the client to arbitrarily increase its own Dance Credits.

## Copyright and Music Rights

DENSEN contains dance videos and music.

Never assume that using music for a specific number of seconds is automatically legal or copyright-safe.

Do not implement a rule such as:

"Under X seconds is always allowed."

Rights depend on the applicable license, permission, platform rules, and jurisdiction.

## Rights Metadata

Where appropriate, support concepts such as:

- LICENSED
- USER_OWNED
- RESTRICTED
- CLAIMED
- DISPUTED
- REMOVED

## Copyright Workflow

Where applicable:

1. Identify the music or media.
2. Determine available rights metadata.
3. Apply the appropriate platform restriction.
4. Record claims.
5. Allow appropriate dispute workflows.
6. Preserve moderation and takedown functionality.
7. Maintain an audit trail.

Never claim that copyright has been verified when no actual verification exists.

## External Providers

If payment or copyright functionality requires an external provider:

- Clearly identify the required integration.
- Do not fake the provider response.
- Do not expose API keys.
- Do not claim production readiness before the required provider configuration exists.

## Final Check

Before completing payment or copyright work:

- Test successful flows.
- Test failed flows.
- Test refunds where applicable.
- Test unauthorized payment manipulation.
- Test Dance Credit protection.
- Check copyright metadata.
- Check restricted media behavior.
- Check that no secrets are exposed.
- Report anything requiring external configuration.
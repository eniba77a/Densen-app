/**
 * DENSEN — Payment provider abstraction (integration point, Day 14).
 * ===================================================================
 * Mirrors `fingerprinting.ts` / `media.ts`: defines the contract a legitimate
 * payment provider implements and ships a not-configured default that FAILS
 * LOUDLY. There is NO fake payment success anywhere: a purchase can only
 * become `paid` when a verified provider event says so (paymentsWire.
 * applyProviderEvent — the webhook seam), and refunds are executed only by
 * the provider's own refund event.
 *
 * Design rules:
 *  - Checkout sessions are created against a real provider intent; DENSEN
 *    stores the provider's intent ref (`purchases.providerRef`) as the money
 *    source of truth and mirrors readable state in `purchases.status`.
 *  - Provider events arrive server-side, signature-verified (raw-body HMAC +
 *    timestamp tolerance per ARCHITECTURE.md §6). Events are idempotent via
 *    `paymentTransactions.by_provider_event` — a replay is a no-op, never a
 *    second charge.
 *  - To wire a real provider (e.g. Stripe): implement `PaymentProvider`,
 *    register it via `setPaymentProvider()` in the server bootstrap only.
 *    Configuration names (values supplied via the platform environment,
 *    never in source): PAYMENTS_PROVIDER, PAYMENTS_WEBHOOK_SECRET,
 *    PAYMENTS_API_KEY. The webhook secret is used ONLY inside the server
 *    runtime to verify raw-body signatures.
 */
import { v } from "convex/values";

/* ---------------- contract ---------------- */

export interface CheckoutSessionRequest {
  /** Opaque DENSEN reference for this intent (purchases._id as a string). */
  purchaseId: string;
  /** Provider intent/transaction id minted by DENSEN at purchase time. */
  providerRef: string;
  amountCents: number;
  /** ISO 4217 — displayed before purchase, never hidden. */
  currency: string;
  /** Human-readable checkout line item. */
  description: string;
}

export interface CheckoutSession {
  /** Where the provider sends the payer to pay. */
  url: string;
  /** The provider's own session/intent id. */
  sessionRef: string;
  /** Epoch-millis after which the session is no longer valid. */
  expiresAt?: number;
}

export interface ProviderEvent {
  /** Provider event id — the webhook idempotency key. */
  eventRef: string;
  /** The purchase/intent this event is about (purchases.providerRef). */
  providerRef: string;
  /** charge_succeeded | charge_failed | refund_executed | dispute_opened … */
  type: string;
  /** Signed minor-unit amount from the provider (charges positive). */
  amountCents: number;
  currency: string;
  /** The provider's own status string — preserved raw for reconciliation. */
  rawStatus: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** Create a real checkout session for a pending purchase. */
  createCheckoutSession(req: CheckoutSessionRequest): Promise<CheckoutSession>;
  /**
   * Verify and parse a webhook delivery. Implementations MUST verify the
   * raw-body signature (HMAC) and enforce a timestamp-tolerance window —
   * unverified payloads never become provider events.
   */
  verifyWebhook(input: {
    /** Raw request body bytes (hex/base64 string from the request). */
    rawBody: string;
    /** Signature header(s) as delivered. */
    signature: string;
  }): Promise<ProviderEvent>;
  /** Create a provider refund for an approved refund request (staff action). */
  createRefund(input: { providerRef: string; amountCents: number; currency: string }): Promise<{ refundRef: string }>;
}

/* ---------------- not-configured default (fails loudly, honestly) ---------------- */

export class PaymentNotConfiguredError extends Error {
  constructor(op: string) {
    super(`PAYMENTS_NOT_CONFIGURED:${op}`);
    this.name = "PaymentNotConfiguredError";
  }
}

const notConfiguredProvider: PaymentProvider = {
  name: "not_configured",
  async createCheckoutSession() {
    throw new PaymentNotConfiguredError("createCheckoutSession");
  },
  async verifyWebhook() {
    throw new PaymentNotConfiguredError("verifyWebhook");
  },
  async createRefund() {
    throw new PaymentNotConfiguredError("createRefund");
  },
};

/* ---------------- server-side registry ---------------- */

let active: PaymentProvider = notConfiguredProvider;

/** Server bootstrap only. Never expose the provider instance or config client-side. */
export function setPaymentProvider(p: PaymentProvider): void {
  active = p;
}

export function getPaymentProvider(): PaymentProvider {
  return active;
}

/** True when a real provider is registered (honest UI state, like media). */
export function isPaymentsConfigured(): boolean {
  return active !== notConfiguredProvider;
}

/* ---------------- shared validators for the wire module ---------------- */

export const checkoutSessionRequestValidator = v.object({
  purchaseId: v.string(),
  providerRef: v.string(),
  amountCents: v.number(),
  currency: v.string(),
  description: v.string(),
});

/** Runtime guard for non-Convex-args code paths (workers, tests). */
export function isProviderEvent(x: unknown): x is ProviderEvent {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Partial<ProviderEvent>;
  return (
    typeof e.eventRef === "string" &&
    e.eventRef.length > 0 &&
    typeof e.providerRef === "string" &&
    typeof e.type === "string" &&
    typeof e.amountCents === "number" &&
    typeof e.currency === "string" &&
    typeof e.rawStatus === "string"
  );
}

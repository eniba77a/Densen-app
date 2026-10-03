"use node";
/**
 * DENSEN — Densen Help AI action (Day 21).
 * ========================================
 * The ONLY place the assistant's model call happens (spec §10): a Convex
 * internal action ("use node") — the API key is read from the server
 * environment and is never exposed to the frontend, and nothing here runs in
 * the user's browser. Scheduled by `helpWire.askHelp` ONLY after the full
 * guard pipeline passed (auth, enabled, rate limit, normalization, crisis/
 * injury/injection/pii/scope checks) and only for in-scope questions the FAQ
 * could not answer.
 *
 * Provider: Fireworks AI (OpenAI-compatible chat completions). The model gets
 * a strict system prompt + a MINIMAL context (current message, last few turns,
 * up to 3 retrieved knowledge-base docs) and its output is scope-validated by
 * the same pure core before it is stored. On missing key / provider error the
 * action lands a pre-approved honest fallback ("not sure — check the app or
 * contact the Densen team") — it never fabricates an AI answer.
 */
import { anyApi, internalActionGeneric } from "convex/server";
import { v } from "convex/values";

import {
  SAFE_REPLIES,
  buildHelpAiMessages,
  findHelpDoc,
  validateAssistantReply,
  type HelpLang,
} from "./helpInternals";

// Convex functions run in a managed server runtime that provides `process.env`.
// Declared locally because the browser-oriented tsconfig has no @types/node.
declare const process: { env: Record<string, string | undefined> };

const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const MAX_TOKENS = 300; // replies stay under ~100 words (spec §6)
const TEMPERATURE = 0.3;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export const generateHelpReply = internalActionGeneric({
  args: {
    userId: v.string(),
    userMessageId: v.string(),
    history: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    docIds: v.array(v.string()),
    lang: v.union(v.literal("en"), v.literal("sq")),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.FIREWORKS_API_KEY;
    const docs = args.docIds.map((id) => findHelpDoc(id)).filter((d): d is NonNullable<typeof d> => Boolean(d));
    const messages = buildHelpAiMessages(args.history, docs, args.lang as HelpLang);

    /** Queue the reply into the thread (actions cannot write directly). */
    const persist = (text: string, answeredBy: "ai" | "safety" | "config", flags: string[]) =>
      ctx.scheduler.runAfter(0, anyApi.helpWire.persistHelpReply, {
        userId: args.userId,
        userMessageId: args.userMessageId,
        text,
        answeredBy,
        flags,
        lang: args.lang,
      });

    // Key vanished between the mutation's check and this action: land the
    // honest fallback — never a fabricated "AI" answer.
    if (!apiKey) {
      await persist(SAFE_REPLIES.notSure[args.lang as HelpLang], "config", ["assistant_unconfigured"]);
      return { ok: false as const, error: "assistant_not_configured" };
    }

    try {
      const res = await fetch(FIREWORKS_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ model: args.model, messages, max_tokens: MAX_TOKENS, temperature: TEMPERATURE }),
      });
      if (!res.ok) {
        await persist(SAFE_REPLIES.notSure[args.lang as HelpLang], "config", ["ai_provider_error"]);
        return { ok: false as const, error: "ai_provider_error" };
      }
      const data = (await res.json()) as ChatCompletionResponse;
      const raw = data?.choices?.[0]?.message?.content ?? "";
      const validated = validateAssistantReply(raw, args.lang as HelpLang);
      await persist(
        validated.reply,
        validated.ok ? "ai" : "safety",
        validated.ok ? [] : [validated.reason ?? "unsafe_output"],
      );
      return { ok: true as const, answeredBy: validated.ok ? "ai" : "safety" };
    } catch {
      await persist(SAFE_REPLIES.notSure[args.lang as HelpLang], "config", ["ai_error"]);
      return { ok: false as const, error: "ai_error" };
    }
  },
});

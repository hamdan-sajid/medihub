import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { env } from "./env.js";

/**
 * Rate control for hard free-tier quotas.
 *
 * Two things matter here, and the second one is easy to miss:
 *
 * 1. A deep agent issues model calls as fast as the graph allows, so calls must
 *    be spaced to the provider's documented rate.
 * 2. The provider SDK's own retry happens *below* this layer. Left at its
 *    default, a single 429 becomes six more immediate requests, which is a
 *    faster way to exhaust a per-minute quota than not pacing at all. So the
 *    SDK retry is disabled and retries are performed here, through the same
 *    gate, honouring the server's stated retry delay.
 *
 * One shared limiter per process: the main agent and every subagent draw on the
 * same quota, because the provider counts them against the same key.
 */
export class MinIntervalLimiter {
  #next = 0;
  readonly #intervalMs: number;

  constructor(requestsPerMinute: number) {
    this.#intervalMs = requestsPerMinute > 0 ? 60_000 / requestsPerMinute : 0;
  }

  async acquire(): Promise<void> {
    if (this.#intervalMs === 0) return;
    const now = Date.now();
    const readyAt = Math.max(now, this.#next);
    this.#next = readyAt + this.#intervalMs;
    const wait = readyAt - now;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  /** Push every queued caller out, after the provider says we are over quota. */
  penalise(ms: number): void {
    this.#next = Math.max(this.#next, Date.now() + ms);
  }
}

const limiter = new MinIntervalLimiter(env.requestsPerMinute);

const MAX_QUOTA_RETRIES = 4;
const DEFAULT_BACKOFF_MS = 60_000;

/**
 * Extract a retry delay from a quota error, or null if this is not one.
 * Google returns both a RetryInfo block and a prose "Please retry in 53.6s".
 */
function quotaBackoffMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const isQuota =
    /429|too many requests|resource_exhausted|quota/i.test(message) &&
    !/context length|token limit/i.test(message);
  if (!isQuota) return null;

  const retryInfo = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  const prose = message.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  const seconds = Number(retryInfo?.[1] ?? prose?.[1]);
  // A second of slack: the server's window and our clock are not the same clock.
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000 + 1_000
    : DEFAULT_BACKOFF_MS;
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(408|500|502|503|504)\b|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(
    message,
  );
}

async function callThroughGate<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await limiter.acquire();
    try {
      return await fn();
    } catch (error) {
      const quota = quotaBackoffMs(error);
      const retryable = quota !== null || isTransient(error);
      if (!retryable || attempt >= MAX_QUOTA_RETRIES) throw error;

      const backoff = quota ?? Math.min(2 ** attempt * 1_000, 16_000);
      // Penalise the shared limiter, not just this caller — every other in-flight
      // request is about to hit the same wall.
      limiter.penalise(backoff);
      console.warn(
        `[model] ${label} ${quota !== null ? "over quota" : "transient error"}; ` +
          `backing off ${(backoff / 1000).toFixed(0)}s (attempt ${attempt + 1}/${MAX_QUOTA_RETRIES})`,
      );
    }
  }
}

/**
 * Route a chat model's generation paths through the gate.
 *
 * `bindTools` returns a binding over this same instance, so the pacing survives
 * tool binding — which matters, because in this harness essentially every call
 * is a tool-bound one.
 */
function paced<T extends BaseChatModel>(model: T): T {
  const target = model as unknown as Record<string, unknown>;

  const generate = target["_generate"];
  if (typeof generate === "function") {
    target["_generate"] = function (this: unknown, ...args: unknown[]) {
      return callThroughGate(
        () => (generate as (...a: unknown[]) => Promise<unknown>).apply(this, args),
        "generate",
      );
    };
  }

  const stream = target["_streamResponseChunks"];
  if (typeof stream === "function") {
    target["_streamResponseChunks"] = async function* (this: unknown, ...args: unknown[]) {
      // Retry only covers opening the stream and pulling the first chunk. Once
      // chunks have been delivered downstream a retry would duplicate them.
      const iterator = await callThroughGate(async () => {
        const it = (stream as (...a: unknown[]) => AsyncIterable<unknown>)
          .apply(this, args)
          [Symbol.asyncIterator]();
        const first = await it.next();
        return { it, first };
      }, "stream");

      if (iterator.first.done) return;
      yield iterator.first.value;
      yield* { [Symbol.asyncIterator]: () => iterator.it };
    };
  }

  return model;
}

/**
 * Build the chat model for the configured provider.
 *
 * Provider is swappable so the project can be developed against a free tier and
 * demonstrated on a stronger model without touching the harness. Nothing below
 * the model boundary knows or cares which one is in use.
 */
export async function buildModel(): Promise<BaseChatModel> {
  // maxRetries: 0 is deliberate — see the note on MinIntervalLimiter. Retries
  // are handled in callThroughGate so they stay behind the rate gate.
  const common = { model: env.model, maxRetries: 0 };

  switch (env.provider) {
    case "google": {
      const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
      return paced(
        new ChatGoogleGenerativeAI({
          ...common,
          apiKey: env.apiKey,
          maxOutputTokens: 8192,
        }) as unknown as BaseChatModel,
      );
    }
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return paced(
        new ChatAnthropic({
          ...common,
          apiKey: env.apiKey,
          maxTokens: 16384,
        }) as unknown as BaseChatModel,
      );
    }
    case "groq": {
      const { ChatGroq } = await import("@langchain/groq");
      return paced(
        new ChatGroq({ ...common, apiKey: env.apiKey }) as unknown as BaseChatModel,
      );
    }
  }
}

import "server-only";

/**
 * Rate limiting — CORE, dependency-free. A fixed-window counter kept in process
 * memory: for each key we track how many hits landed in the current window and when
 * the window resets. Blocks once the count reaches the limit until the window rolls.
 *
 * SCOPE / DEPLOY NOTE: the store is IN-MEMORY, so limits are enforced per server
 * instance. On a single box (the likely first deploy) that is exactly right. On a
 * multi-instance / serverless host the counters don't share, so swap `Limiter` for a
 * Redis/Postgres-backed implementation of the same tiny surface at the §Z deploy phase.
 * Kept out of the Edge proxy on purpose — Edge isolates don't share memory, so an
 * in-memory limiter there would be meaningless; login (the key target) runs in Node.
 */

type Bucket = { count: number; resetAt: number };

export type RateVerdict = {
  /** True when this key is currently over its limit. */
  blocked: boolean;
  /** Hits still allowed in the current window (0 when blocked). */
  remaining: number;
  /** Milliseconds until the window resets (0 when not blocked). */
  retryAfterMs: number;
};

export class Limiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    /** Max hits allowed per window. */
    private readonly limit: number,
    /** Window length in milliseconds. */
    private readonly windowMs: number,
  ) {}

  private live(key: string, now: number): Bucket | undefined {
    const b = this.buckets.get(key);
    if (!b) return undefined;
    if (now >= b.resetAt) {
      this.buckets.delete(key); // window elapsed — treat as fresh
      return undefined;
    }
    return b;
  }

  private verdict(b: Bucket | undefined, now: number): RateVerdict {
    if (!b) return { blocked: false, remaining: this.limit, retryAfterMs: 0 };
    const blocked = b.count >= this.limit;
    return {
      blocked,
      remaining: Math.max(0, this.limit - b.count),
      retryAfterMs: blocked ? Math.max(0, b.resetAt - now) : 0,
    };
  }

  /** Is this key currently blocked? Does NOT count as a hit. */
  peek(key: string): RateVerdict {
    return this.verdict(this.live(key, Date.now()), Date.now());
  }

  /** Record one hit against the key and return the resulting verdict. */
  hit(key: string): RateVerdict {
    const now = Date.now();
    let b = this.live(key, now);
    if (!b) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
    return this.verdict(b, now);
  }

  /** Clear a key (e.g. after a successful login). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Drop expired buckets so the map can't grow without bound. */
  prune(): void {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now >= b.resetAt) this.buckets.delete(k);
  }
}

// ---- Shared limiters -------------------------------------------------------

const MIN = 60_000;

/** Failed logins per USERNAME — the primary brute-force gate. Reset on success. */
export const loginByUser = new Limiter(5, 15 * MIN);
/** Failed logins per IP — catches spraying across many usernames from one source.
 *  Deliberately generous so a whole clinic behind one NAT isn't locked out. */
export const loginByIp = new Limiter(50, 15 * MIN);

/** Password-reset requests per identifier (username/email) — throttle abuse/spam. */
export const resetByIdentifier = new Limiter(3, 15 * MIN);
/** Password-reset requests per IP — generous (shared NAT) but caps a spray. */
export const resetByIp = new Limiter(20, 15 * MIN);

// ---- Generic route throttle ------------------------------------------------

/** AI scribe per user — bounds PAID Whisper+Claude spend if a recorder loops. */
export const aiScribeByUser = new Limiter(20, 10 * MIN);

/**
 * WhatsApp classification, per patient phone — bounds PAID spend on the one AI path
 * anybody can trigger.
 *
 * The scribe limiter above throttles an authenticated user. This one throttles an
 * UNAUTHENTICATED stranger: anyone who knows a clinic's WhatsApp number can send it
 * messages, and each unparsed one would otherwise be a paid model call. Generous
 * enough that a patient going back and forth about a slot is never cut off, tight
 * enough that a loop or a bored teenager costs pennies.
 */
export const chatIntentByPhone = new Limiter(10, 60 * MIN);

/**
 * The same spend, bounded per CLINIC as well — because per-phone caps do nothing
 * against many phones. This is the ceiling that decides the worst case on the
 * monthly bill, so it is the one to raise deliberately rather than by feel.
 */
export const chatIntentByClinic = new Limiter(300, 24 * 60 * MIN);

/**
 * Peek-then-hit: allow up to the limit, then report how long until the window rolls.
 * Use at the top of a Route Handler:
 *   const g = throttle(aiScribeByUser, `scribe:${user.id}`);
 *   if (!g.ok) return tooManyRequests(g.retryAfterMs);
 */
export function throttle(
  limiter: Limiter,
  key: string,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const p = limiter.peek(key);
  if (p.blocked) return { ok: false, retryAfterMs: p.retryAfterMs };
  limiter.hit(key);
  return { ok: true };
}

/** A standard 429 response with a Retry-After header + JSON `{ error }` body. */
export function tooManyRequests(retryAfterMs: number): Response {
  return new Response(
    JSON.stringify({ error: `Too many requests. Please try again in ${retryAfterLabel(retryAfterMs)}.` }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.ceil(retryAfterMs / 1000)),
      },
    },
  );
}

/** Human-friendly "try again in N minutes/seconds" from a retry-after in ms. */
export function retryAfterLabel(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs} second${secs === 1 ? "" : "s"}`;
  const mins = Math.ceil(secs / 60);
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

// Periodic cleanup — unref'd so it never keeps the process alive.
const ALL = [loginByUser, loginByIp, resetByIdentifier, resetByIp, aiScribeByUser];
const timer = setInterval(() => ALL.forEach((l) => l.prune()), 10 * MIN);
if (typeof timer === "object" && "unref" in timer) timer.unref();

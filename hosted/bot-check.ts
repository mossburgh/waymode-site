import { z } from "zod";
import { HttpError } from "./http.js";
import type { Store, Visitor } from "./store.js";

export type BotEnv = { TURNSTILE_SECRET?: string; TURNSTILE_SITE_KEY?: string };
const lifetime = 15 * 60 * 1000;
type Grant = { network: string };
type Challenge = Grant & { nonce: string };

export function requireVerification(
  store: Store,
  visitor: Visitor,
  network: string,
) {
  if (store.read<Grant>(`verified:${visitor.id}`)?.network !== network) {
    throw new HttpError(
      403,
      "Complete the security check before using Waymode.",
    );
  }
}

export class BotCheck {
  constructor(
    private env: BotEnv,
    private store: Store,
  ) {}
  config(visitor: Visitor, network: string) {
    if (this.store.read<Grant>(`verified:${visitor.id}`)?.network === network) {
      return { required: false };
    }
    let challenge = this.store.read<Challenge>(`challenge:${visitor.id}`);
    if (!challenge || challenge.network !== network) {
      challenge = { network, nonce: crypto.randomUUID() };
      this.store.write(`challenge:${visitor.id}`, challenge, visitor.expires);
    }
    return {
      required: true,
      sitekey: this.env.TURNSTILE_SITE_KEY,
      nonce: challenge.nonce,
    };
  }
  async verify(
    visitor: Visitor,
    network: string,
    remoteip: string | null,
    input: unknown,
    signal: AbortSignal,
  ) {
    this.store.take(`verify:${network}`, 10, 60000);
    const { token } = z
      .strictObject({ token: z.string().min(1).max(2048) })
      .parse(input);
    const challenge = this.store.read<Challenge>(`challenge:${visitor.id}`);
    if (
      !this.env.TURNSTILE_SECRET ||
      !challenge ||
      challenge.network !== network
    ) {
      throw new HttpError(403, "Reload the page and retry the security check.");
    }
    await validateToken(
      this.env.TURNSTILE_SECRET,
      token,
      remoteip,
      challenge.nonce,
      signal,
    );
    // A request may have expired while Cloudflare was verifying it.
    if (!this.store.read<Visitor>(`visitor:${visitor.id}`)) {
      throw new HttpError(401, "Reload the demo to start a new session.");
    }
    this.store.write(
      `verified:${visitor.id}`,
      { network },
      Math.min(visitor.expires, Date.now() + lifetime),
    );
  }
}

async function validateToken(
  secret: string,
  token: string,
  remoteip: string | null,
  nonce: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: new URLSearchParams({
        secret: secret,
        response: token,
        ...(remoteip && { remoteip }),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    },
  );
  const result = z
    .object({
      success: z.boolean(),
      hostname: z.string().optional(),
      action: z.string().optional(),
      cdata: z.string().optional(),
    })
    .parse(await response.json());
  if (
    !response.ok ||
    !result.success ||
    !["waymode.ai", "www.waymode.ai"].includes(result.hostname ?? "") ||
    result.action !== "waymode" ||
    result.cdata !== nonce
  ) {
    throw new HttpError(403, "The security check failed. Please try again.");
  }
}

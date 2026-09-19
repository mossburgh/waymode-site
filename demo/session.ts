import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const lifetimeMs = 3_600_000;
const maximumSessions = 100;
const cookieName = "waymode_session";
const tokenPattern =
  /^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([0-9]{13})\.([A-Za-z0-9_-]{43})$/;

export type DemoSessionState = {
  calls: number;
  active: boolean;
  expires: number;
};
type ResolvedSession = {
  id: string;
  state: DemoSessionState;
  setCookie?: string;
};

const loadSecret = async (directory: string) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "session-secret");
  try {
    await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    )) {
      throw error;
    }
  }
  const secret = await readFile(path);
  if (secret.length !== 32) {
    throw new Error("The local demo session secret is damaged");
  }
  return secret;
};

type Token = { id: string; expires: number };
const sign = (secret: Buffer, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");
const readToken = (secret: Buffer, header: string | undefined, now: number) => {
  const cookie = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const match = cookie?.slice(cookieName.length + 1).match(tokenPattern);
  if (!match) {
    return undefined;
  }
  const [, id, expiration, signature] = match;
  if (!id || !expiration || !signature) {
    return undefined;
  }
  const expected = sign(secret, `${id}.${expiration}`);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return undefined;
  }
  const expires = Number(expiration);
  if (expires <= now || expires > now + lifetimeMs) {
    return undefined;
  }
  return { id, expires };
};
const createSession = (
  secret: Buffer,
  states: Map<string, DemoSessionState>,
  token: Token | undefined,
  now: number,
): ResolvedSession => {
  if (states.size >= maximumSessions) {
    throw new Error(
      "Local demo session limit reached. Wait for a session to expire.",
    );
  }
  const id = token?.id ?? randomUUID();
  const expires = token?.expires ?? now + lifetimeMs;
  const state = { calls: 0, active: false, expires };
  states.set(id, state);
  if (token) {
    return { id, state };
  }
  const payload = `${id}.${expires}`;
  return {
    id,
    state,
    setCookie: `${cookieName}=${payload}.${sign(secret, payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${lifetimeMs / 1000}`,
  };
};
export const createDemoSessions = async (directory: string) => {
  const secret = await loadSecret(directory);
  const states = new Map<string, DemoSessionState>();
  const resolve = (header?: string): ResolvedSession => {
    const now = Date.now();
    for (const [id, state] of states) {
      if (state.expires <= now) {
        states.delete(id);
      }
    }
    const token = readToken(secret, header, now);
    const existing = token && states.get(token.id);
    if (token && existing) {
      return { id: token.id, state: existing };
    }
    return createSession(secret, states, token, now);
  };
  return { resolve };
};

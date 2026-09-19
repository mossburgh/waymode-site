import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/server";
import { z } from "zod";

const challengeLifetimeMs = 120_000;
const maximumPendingSessions = 256;
const sessionSchema = z.uuid();
const base64url = z
  .string()
  .min(1)
  .max(65_536)
  .regex(/^[A-Za-z0-9_-]+$/);
const transportsSchema = z.array(z.string().max(32)).max(16);
const registrationSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: transportsSchema.optional(),
  }),
  clientExtensionResults: z.object({}),
});
const credentialSchema = z.object({
  id: base64url,
  publicKey: base64url,
  counter: z.number().int().nonnegative(),
  transports: transportsSchema,
});

export type PasskeyStatus = { registered: boolean; credentialCount: number };
export type PasskeyStore = {
  options: (
    sessionId: string,
  ) => Promise<PublicKeyCredentialCreationOptionsJSON>;
  verify: (sessionId: string, response: unknown) => Promise<PasskeyStatus>;
  status: (sessionId: string) => Promise<PasskeyStatus>;
};

type Challenge = { challenge?: string; expiresAt: number };
type Registration = {
  origin: string;
  directory: string;
  hostname: string;
  pending: Map<string, Challenge>;
};
const filename = (directory: string, sessionId: string) =>
  join(directory, `${sessionSchema.parse(sessionId)}.json`);
const readCredential = async (directory: string, sessionId: string) => {
  const path = filename(directory, sessionId);
  try {
    return credentialSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};
const reserveChallenge = (
  pending: Registration["pending"],
  sessionId: string,
) => {
  sessionSchema.parse(sessionId);
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (entry.expiresAt <= now) {
      pending.delete(id);
    }
  }
  if (!pending.has(sessionId) && pending.size >= maximumPendingSessions) {
    throw new Error("Too many pending passkey registrations");
  }
  const entry: Challenge = { expiresAt: now + challengeLifetimeMs };
  pending.set(sessionId, entry);
  return entry;
};
const registrationOptions = (hostname: string, sessionId: string) =>
  generateRegistrationOptions({
    rpName: "waymode demo",
    rpID: hostname,
    userName: `demo-${sessionId}`,
    userDisplayName: "Local demo account",
    userID: new TextEncoder().encode(sessionId),
    timeout: challengeLifetimeMs,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
const options = async (registration: Registration, sessionId: string) => {
  const { pending, directory, hostname } = registration;
  const entry = reserveChallenge(pending, sessionId);
  try {
    if (await readCredential(directory, sessionId)) {
      throw new Error("This demo account already has a passkey");
    }
    const result = await registrationOptions(hostname, sessionId);
    entry.challenge = result.challenge;
    return result;
  } catch (error) {
    if (pending.get(sessionId) === entry) {
      pending.delete(sessionId);
    }
    throw error;
  }
};
const consumeChallenge = (
  pending: Registration["pending"],
  sessionId: string,
) => {
  const entry = pending.get(sessionId);
  pending.delete(sessionId);
  if (!entry?.challenge || entry.expiresAt <= Date.now()) {
    throw new Error("Passkey challenge is missing or expired; start again");
  }
  return entry.challenge;
};
const verifyResponse = (
  registration: Registration,
  challenge: string,
  response: unknown,
) => {
  const parsed = registrationSchema.parse(response);
  return verifyRegistrationResponse({
    response: {
      ...parsed,
      response: {
        clientDataJSON: parsed.response.clientDataJSON,
        attestationObject: parsed.response.attestationObject,
        ...(parsed.response.transports
          ? { transports: parsed.response.transports }
          : {}),
      },
    },
    expectedChallenge: challenge,
    expectedOrigin: registration.origin,
    expectedRPID: registration.hostname,
    requireUserVerification: true,
    requireUserPresence: true,
  });
};
const verify = async (
  registration: Registration,
  sessionId: string,
  response: unknown,
): Promise<PasskeyStatus> => {
  const path = filename(registration.directory, sessionId);
  const challenge = consumeChallenge(registration.pending, sessionId);
  const result = await verifyResponse(registration, challenge, response);
  if (!result.verified) {
    throw new Error("Passkey registration could not be verified");
  }
  const { credential } = result.registrationInfo;
  const stored = credentialSchema.parse({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? [],
  });
  await mkdir(registration.directory, { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(stored), { flag: "wx", mode: 0o600 });
  return { registered: true, credentialCount: 1 };
};
// Local demo accounts come from the server's signed, HttpOnly session cookie.
export const createPasskeyStore = ({
  origin,
  directory,
}: {
  origin: string;
  directory: string;
}): PasskeyStore => {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname === "localhost"))
  ) {
    throw new Error("Passkeys require an HTTPS origin or http://localhost");
  }
  const registration: Registration = {
    origin,
    directory,
    hostname: url.hostname,
    pending: new Map(),
  };
  return {
    options: (sessionId) => options(registration, sessionId),
    verify: (sessionId, response) => verify(registration, sessionId, response),
    status: async (sessionId) => {
      const credential = await readCredential(directory, sessionId);
      return {
        registered: credential !== undefined,
        credentialCount: credential ? 1 : 0,
      };
    },
  };
};

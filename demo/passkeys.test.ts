import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPasskeyStore } from "./passkeys.js";

const origin = "http://localhost:4173";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "waymode-passkeys-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

const invalidAttestation = (challenge: string, responseOrigin = origin) => ({
  id: "aW52YWxpZA",
  rawId: "aW52YWxpZA",
  type: "public-key",
  response: {
    clientDataJSON: Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge,
        origin: responseOrigin,
      }),
    ).toString("base64url"),
    attestationObject: "aW52YWxpZA",
  },
  clientExtensionResults: {},
});

it("creates unique challenges, binds the account, and requires user verification", async () => {
  const store = createPasskeyStore({ origin, directory });
  const session = randomUUID();
  const first = await store.options(session);
  const second = await store.options(session);
  expect(first.challenge).not.toBe(second.challenge);
  expect(first.user.id).toBe(second.user.id);
  expect(first.rp.id).toBe("localhost");
  expect(first.authenticatorSelection?.userVerification).toBe("required");
  expect(await store.status(session)).toEqual({
    registered: false,
    credentialCount: 0,
  });
});

it("rejects another session challenge and consumes the failed attempt", async () => {
  const store = createPasskeyStore({ origin, directory });
  const session = randomUUID();
  await store.options(session);
  const other = await store.options(randomUUID());
  await expect(
    store.verify(session, invalidAttestation(other.challenge)),
  ).rejects.toThrow(/challenge/);
  await expect(
    store.verify(session, invalidAttestation(other.challenge)),
  ).rejects.toThrow(/missing or expired/i);
  expect(await store.status(session)).toEqual({
    registered: false,
    credentialCount: 0,
  });
  expect(await readdir(directory)).toEqual([]);
});

it("rejects an unexpected origin and invalid attestation without registering", async () => {
  const store = createPasskeyStore({ origin, directory });
  const session = randomUUID();
  const first = await store.options(session);
  await expect(
    store.verify(
      session,
      invalidAttestation(first.challenge, "https://attacker.example"),
    ),
  ).rejects.toThrow(/origin/);
  const next = await store.options(session);
  await expect(
    store.verify(session, invalidAttestation(next.challenge)),
  ).rejects.toThrow();
  expect(await store.status(session)).toEqual({
    registered: false,
    credentialCount: 0,
  });
});

it("expires challenges after 120 seconds", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = createPasskeyStore({ origin, directory });
  const session = randomUUID();
  const options = await store.options(session);
  vi.setSystemTime(Date.now() + 120_000);
  await expect(
    store.verify(session, invalidAttestation(options.challenge)),
  ).rejects.toThrow(/missing or expired/i);
});

it("consumes malformed attempts and rejects concurrent replays", async () => {
  const store = createPasskeyStore({ origin, directory });
  const session = randomUUID();
  await store.options(session);
  await expect(store.verify(session, {})).rejects.toThrow();
  await expect(store.verify(session, {})).rejects.toThrow(
    /missing or expired/i,
  );
  const options = await store.options(session);
  const results = await Promise.allSettled([
    store.verify(session, invalidAttestation(options.challenge)),
    store.verify(session, invalidAttestation(options.challenge)),
  ]);
  expect(results.every((result) => result.status === "rejected")).toBe(true);
  expect(
    results.some(
      (result) =>
        result.status === "rejected" &&
        /missing or expired/i.test(String(result.reason)),
    ),
  ).toBe(true);
});

it("rejects unsafe session paths on every entry point", async () => {
  const store = createPasskeyStore({ origin, directory });
  for (const session of ["../credentials", "", "arbitrary-account"]) {
    await expect(store.options(session)).rejects.toThrow();
    await expect(store.verify(session, {})).rejects.toThrow();
    await expect(store.status(session)).rejects.toThrow();
  }
});

it("bounds pending sessions and frees expired entries", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const store = createPasskeyStore({ origin, directory });
  await Promise.all(
    Array.from({ length: 256 }, () => store.options(randomUUID())),
  );
  await expect(store.options(randomUUID())).rejects.toThrow(/too many/i);
  vi.setSystemTime(Date.now() + 120_000);
  await expect(store.options(randomUUID())).resolves.toHaveProperty(
    "challenge",
  );
});

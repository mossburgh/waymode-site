import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDemoSessions } from "./session.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "waymode-sessions-"));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});
const cookie = (header: string | undefined) => header!.split(";")[0]!;

it("keeps the account identity across restart with a private persistent secret", async () => {
  const sessions = await createDemoSessions(directory);
  const first = sessions.resolve();
  first.state.calls = 5;
  expect(sessions.resolve(cookie(first.setCookie)).state.calls).toBe(5);
  const restarted = await createDemoSessions(directory);
  const restored = restarted.resolve(cookie(first.setCookie));
  expect(restored.id).toBe(first.id);
  expect(restored.setCookie).toBeUndefined();
  expect(restored.state.calls).toBe(0);
  expect(first.setCookie).toContain("HttpOnly; SameSite=Strict");
  expect((await stat(join(directory, "session-secret"))).mode & 0o777).toBe(
    0o600,
  );
  expect((await readFile(join(directory, "session-secret"))).length).toBe(32);
});

it("rejects forged identities, expiration times, signatures, and unsigned cookies", async () => {
  const sessions = await createDemoSessions(directory);
  const first = sessions.resolve();
  const original = cookie(first.setCookie);
  const [id, expires, signature] = original.split("=")[1]!.split(".");
  for (const forged of [
    `waymode_session=${randomUUID()}.${expires}.${signature}`,
    `waymode_session=${id}.${Number(expires) + 60_000}.${signature}`,
    `waymode_session=${id}.${expires}.${"a".repeat(43)}`,
    `waymode_session=${id}`,
    `waymode_session=../../secret.${expires}.${signature}`,
  ]) {
    const result = sessions.resolve(forged);
    expect(result.id).not.toBe(first.id);
    expect(result.setCookie).toBeDefined();
  }
  expect(sessions.resolve(`other=1; ${original}; other2=2`).id).toBe(first.id);
});

it("rejects expired signed cookies even after restart", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const sessions = await createDemoSessions(directory);
  const first = sessions.resolve();
  vi.setSystemTime(Date.now() + 3_600_000);
  const restarted = await createDemoSessions(directory);
  expect(restarted.resolve(cookie(first.setCookie)).id).not.toBe(first.id);
});

it("bounds live sessions and clears expired entries", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const sessions = await createDemoSessions(directory);
  const first = sessions.resolve();
  for (let index = 1; index < 100; index++) {
    sessions.resolve();
  }
  expect(() => sessions.resolve()).toThrow(/session limit/);
  expect(sessions.resolve(cookie(first.setCookie)).id).toBe(first.id);
  vi.setSystemTime(Date.now() + 3_600_000);
  expect(() => sessions.resolve()).not.toThrow();
});

it("fails closed on a damaged secret instead of silently replacing it", async () => {
  await writeFile(join(directory, "session-secret"), "damaged");
  await expect(createDemoSessions(directory)).rejects.toThrow(/secret/);
});

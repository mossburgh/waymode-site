import { afterEach, expect, it, vi } from "vitest";
import { Playback } from "./playback.js";

afterEach(() => vi.useRealTimers());

it("starts the scene clock after loading while preserving pause", async () => {
  vi.useFakeTimers();
  const run = new Playback();
  await vi.advanceTimersByTimeAsync(1500);
  run.pause();
  run.startClock();
  expect(run.elapsedMs).toBe(0);
  expect(run.paused).toBe(true);
});

it("holds timed steps and elapsed time while paused, then resumes once", async () => {
  vi.useFakeTimers();
  const run = new Playback();
  const next = vi.fn();
  const waiting = run.wait(100).then(next);
  await vi.advanceTimersByTimeAsync(50);
  run.pause();
  await vi.advanceTimersByTimeAsync(1000);
  expect(run.elapsedMs).toBe(50);
  expect(next).not.toHaveBeenCalled();
  run.resume();
  await vi.advanceTimersByTimeAsync(50);
  await waiting;
  expect(next).toHaveBeenCalledOnce();
  expect(run.elapsedMs).toBe(100);
});

it("holds a completed network step at the next checkpoint until resumed", async () => {
  vi.useFakeTimers();
  const run = new Playback();
  run.pause();
  const next = vi.fn();
  const waiting = run.wait().then(next);
  await vi.advanceTimersByTimeAsync(100);
  expect(next).not.toHaveBeenCalled();
  run.resume();
  await vi.advanceTimersByTimeAsync(25);
  await waiting;
  expect(next).toHaveBeenCalledOnce();
});

it("aborts a paused walkthrough without running the next step", async () => {
  vi.useFakeTimers();
  const run = new Playback();
  run.pause();
  const waiting = run.wait();
  run.abort();
  await Promise.all([
    expect(waiting).rejects.toMatchObject({ name: "AbortError" }),
    vi.advanceTimersByTimeAsync(25),
  ]);
});

it("seeks to a checkpoint, holds there when paused, then continues", async () => {
  vi.useFakeTimers();
  const run = new Playback({ chapter: "act", elapsedMs: 5000, paused: true });
  await run.wait(10000);
  expect(run.seeking).toBe(true);
  const advanced = vi.fn();
  const waiting = run.checkpoint("act").then(advanced);
  await vi.advanceTimersByTimeAsync(1000);
  expect(run.elapsedMs).toBe(5000);
  expect(advanced).not.toHaveBeenCalled();
  expect(run.seeking).toBe(false);
  run.resume();
  await vi.advanceTimersByTimeAsync(25);
  await waiting;
  expect(advanced).toHaveBeenCalledOnce();
});

it("honors a pause or resume made while a seek is still loading", async () => {
  vi.useFakeTimers();
  const run = new Playback({ chapter: "act", paused: false });
  run.pause();
  await run.wait(2000);
  const next = vi.fn();
  const waiting = run.checkpoint("act").then(next);
  await vi.advanceTimersByTimeAsync(1000);
  expect(next).not.toHaveBeenCalled();
  run.resume();
  await vi.advanceTimersByTimeAsync(25);
  await waiting;
  expect(next).toHaveBeenCalledOnce();
  const resumed = new Playback({ chapter: "act", paused: true });
  resumed.resume();
  await resumed.checkpoint("act");
  expect(resumed.paused).toBe(false);
});

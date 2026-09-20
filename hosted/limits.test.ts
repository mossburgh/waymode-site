import { expect, it } from "vitest";
import { modelLimits } from "./limits.js";
it("expires the temporary shared boost without raising individual quotas", () => {
  const now = Date.parse("2026-09-20T12:00Z");
  const env = { DEMO_BOOST_UNTIL: "2026-09-23T00:00Z" };
  expect(modelLimits(env, now)).toEqual({ daily: 1200, ip: 100, visitor: 60 });
  expect(modelLimits(env, Date.parse(env.DEMO_BOOST_UNTIL))).toEqual({
    daily: 600,
    ip: 100,
    visitor: 60,
  });
  expect(modelLimits({ DEMO_BOOST_UNTIL: "2099-01-01" }, now).daily).toBe(600);
});

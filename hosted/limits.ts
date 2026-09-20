export type LimitsEnv = { DEMO_BOOST_UNTIL?: string };

export const modelLimits = (env: LimitsEnv, now = Date.now()) => {
  const expires = Date.parse(env.DEMO_BOOST_UNTIL ?? "");
  const boosted = expires > now && expires <= now + 3 * 86400000;
  return {
    daily: boosted ? 1200 : 600,
    ip: 100,
    visitor: 60,
  };
};

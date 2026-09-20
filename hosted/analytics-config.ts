export type AnalyticsEnv = {
  POSTHOG_PUBLIC_KEY?: string;
  POSTHOG_REGION?: string;
};
export function analyticsConfig(env: AnalyticsEnv) {
  if (!/^phc_[A-Za-z0-9_-]{20,200}$/.test(env.POSTHOG_PUBLIC_KEY ?? "")) {
    return { enabled: false };
  }
  return {
    key: env.POSTHOG_PUBLIC_KEY,
    host:
      env.POSTHOG_REGION === "eu"
        ? "https://eu.i.posthog.com"
        : "https://us.i.posthog.com",
  };
}

import { expect, it } from "vitest";
import { rateLimitDetail, responseError } from "./request-error.js";
it("explains an SDK rate limit without blaming credentials", () => {
  const detail = rateLimitDetail(
    new Error(
      "Decision request failed (429). Check the server connection and credential.",
    ),
  );
  expect(detail).toContain("request limit");
  expect(detail).toContain("changes already saved remain");
  expect(detail).not.toContain("credential");
  expect(
    rateLimitDetail(new Error("Decision request failed (401).")),
  ).toBeUndefined();
});
it("preserves server status and retry time for the presentation request", async () => {
  const error = await responseError(
    Response.json(
      { error: "Limit reached" },
      {
        status: 429,
        headers: { "Retry-After": "90" },
      },
    ),
  );
  expect(error.status).toBe(429);
  expect(rateLimitDetail(error)).toContain("about 2 minutes");
});
it("handles non-JSON responses and invalid retry headers", async () => {
  const error = await responseError(
    new Response("<h1>Busy</h1>", {
      status: 503,
      headers: { "Retry-After": "nonsense" },
    }),
  );
  expect(error.message).toBe(
    "The request could not be completed. Please retry.",
  );
  expect(error.retryAfter).toBeUndefined();
  expect(rateLimitDetail(error)).toBeUndefined();
});

export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export async function responseError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  const message =
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error.slice(0, 300)
      : "The request could not be completed. Please retry.";
  const seconds = Number(response.headers.get("Retry-After"));
  return new RequestError(
    response.status,
    message,
    Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
  );
}

export function rateLimitDetail(error: unknown) {
  const limited =
    error instanceof RequestError
      ? error.status === 429
      : error instanceof Error && error.message.includes("(429)");
  if (!limited) {
    return undefined;
  }
  const seconds = error instanceof RequestError ? error.retryAfter : undefined;
  let retry = "Try again later";
  if (seconds) {
    const minutes = Math.ceil(seconds / 60);
    retry =
      seconds <= 60
        ? `Try again in ${Math.ceil(seconds)} seconds`
        : `Try again in about ${minutes} minutes`;
  }
  return `Waymode has reached a request limit. ${retry}; you can still use the page controls. Any changes already saved remain.`;
}

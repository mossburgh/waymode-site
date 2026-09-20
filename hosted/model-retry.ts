import { HttpError } from "./http.js";
export async function retryModel<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "GatewayInternalServerError"
      ) {
        throw error;
      }
      if (
        "statusCode" in error &&
        typeof error.statusCode === "number" &&
        error.statusCode < 500
      ) {
        break;
      }
    }
  }
  throw new HttpError(
    503,
    "The model service is temporarily unavailable. Please retry.",
  );
}

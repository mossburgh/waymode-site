export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Strict-Transport-Security": "max-age=31536000",
    },
  });
export const readJson = async (request: Request): Promise<unknown> => {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new HttpError(415, "Send JSON.");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) {
    throw new HttpError(400, "Missing request body.");
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.length;
    if (size > 16384) {
      reader.releaseLock();
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(await new Blob(chunks as BlobPart[]).text()) as unknown;
};
export const errorResponse = (error: unknown) =>
  json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "The request could not be completed.",
    },
    error instanceof HttpError ? error.status : 400,
  );

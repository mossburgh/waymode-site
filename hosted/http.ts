export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
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
const readChunks = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.length;
    if (size > 16384) {
      void reader.cancel().catch(() => {});
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(await new Blob(chunks as BlobPart[]).text()) as unknown;
};
export const readJson = async (request: Request): Promise<unknown> => {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new HttpError(415, "Send JSON.");
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new HttpError(400, "Missing request body.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HttpError(408, "Request body timed out."));
      void reader.cancel().catch(() => {});
    }, 10000);
  });
  try {
    return await Promise.race([readChunks(reader), deadline]);
  } finally {
    clearTimeout(timer);
  }
};
export const errorResponse = (error: unknown) => {
  const response = json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "The request could not be completed.",
    },
    error instanceof HttpError ? error.status : 400,
  );
  if (error instanceof HttpError && error.retryAfter) {
    response.headers.set("Retry-After", String(error.retryAfter));
  }
  return response;
};

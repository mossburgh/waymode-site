import { execFile } from "node:child_process";
import { resolve } from "node:path";

/** Run the client in a separate process; its only app access is authenticated HTTP. */
export const runExternalAgent = (
  input: { origin: string; cookie: string; goal: string },
  signal: AbortSignal,
): Promise<unknown> =>
  new Promise((accept, reject) => {
    const child = execFile(
      process.execPath,
      [resolve("demo/tools/external-agent.mjs")],
      {
        signal,
        timeout: 30_000,
        maxBuffer: 128_000,
        env: { PATH: process.env.PATH, PORT: process.env.PORT },
      },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              "External agent failed; check saved state before retrying.",
            ),
          );
          return;
        }
        try {
          accept(JSON.parse(stdout) as unknown);
        } catch {
          reject(new Error("External agent returned an invalid receipt."));
        }
      },
    );
    child.stdin?.end(JSON.stringify(input));
  });

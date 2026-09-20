import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";

const directory = "/scratch/app";
const marker = "WAYMODE_DUMMY_PRIVATE_FILE_20260918";
const results = [];
const variant = process.argv[2];

const linkDependencies = async () => {
  await mkdir(`${directory}/node_modules`);
  for (const entry of await readdir("/fixture/node_modules")) {
    await symlink(
      `/fixture/node_modules/${entry}`,
      `${directory}/node_modules/${entry}`,
    );
  }
};

const writeDummyFiles = async () => {
  for (const name of [".demo-data", "artifacts", "demo/public"]) {
    await mkdir(`${directory}/${name}`, { recursive: true });
  }
  await writeFile(
    `${directory}/.demo-data/session-secret`,
    "01234567890123456789012345678901",
    { mode: 0o600 },
  );
  await writeFile(`${directory}/artifacts/private-fixture.txt`, marker, {
    mode: 0o600,
  });
  await writeFile(`${directory}/.env.fixture`, marker, { mode: 0o600 });
  await writeFile(
    `${directory}/demo/public/allowed-fixture.txt`,
    "DUMMY_PUBLIC_ASSET",
  );
};

const restoreBroadAllowlist = async () => {
  if (variant !== "baseline") {
    return;
  }
  const path = `${directory}/demo/server.ts`;
  const original = await readFile(path, "utf8");
  const revised = original.replace(
    'allow: [resolve("demo"), resolve("node_modules")]',
    "allow: [process.cwd()]",
  );
  assert.notEqual(revised, original);
  await writeFile(path, revised);
};

const prepare = async () => {
  await cp("/fixture/source", directory, { recursive: true });
  await linkDependencies();
  await writeDummyFiles();
  await restoreBroadAllowlist();
};

const request = (path) =>
  new Promise((resolve, reject) => {
    const pending = httpRequest(
      {
        hostname: "127.0.0.1",
        port: 4317,
        path,
        headers: { Host: "localhost:4317" },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) {
            pending.destroy(new Error("Response exceeds limit"));
          }
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, body }),
        );
        response.on("error", reject);
      },
    );
    pending.on("error", reject);
    pending.setTimeout(5000, () =>
      pending.destroy(new Error("Request timeout")),
    );
    pending.end();
  });

const waitUntilReady = async (server) => {
  let lastStatus;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    assert.equal(server.exitCode, null, "demo must remain running");
    try {
      const response = await request("/api/v1/session");
      lastStatus = response.status;
      if (response.status === 200) {
        return;
      }
    } catch (error) {
      lastStatus = String(error);
    }
    await pause(100);
  }
  throw new Error(
    `Demo did not become ready within twenty seconds; last status ${lastStatus}`,
  );
};

const checkAllowed = async (path, expectedText) => {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert.ok(response.body.includes(expectedText), path);
  results.push({ path, status: response.status, result: "allowed" });
};

const checkPrivate = async (path, privateText) => {
  const response = await request(path);
  const exposed = response.body.includes(privateText);
  const baselineExposure =
    variant === "baseline" && !path.includes(".env.fixture");
  assert.equal(exposed, baselineExposure, path);
  if (baselineExposure) {
    assert.equal(response.status, 200, path);
  } else {
    assert.ok(response.status === 403 || response.status === 404, path);
  }
  results.push({
    path,
    status: response.status,
    result: exposed ? "dummy-disclosed" : "denied",
  });
};

const checkPaths = async () => {
  await checkAllowed("/", "Your Product");
  await checkAllowed(
    "/@fs/scratch/app/demo/product-main.ts",
    "BroadcastChannel",
  );
  await checkAllowed("/allowed-fixture.txt", "DUMMY_PUBLIC_ASSET");
  await checkPrivate(
    "/@fs/scratch/app/.demo-data/session-secret",
    "01234567890123456789012345678901",
  );
  await checkPrivate("/@fs/scratch/app/artifacts/private-fixture.txt", marker);
  await checkPrivate(
    "/@fs/scratch/app/artifacts/private-fixture.txt?raw",
    marker,
  );
  await checkPrivate(
    "/@fs/scratch/app/%2e%64emo-data/session-secret",
    "01234567890123456789012345678901",
  );
  await checkPrivate("/@fs/scratch/app/.env.fixture", marker);
};

await prepare();
const server = spawn(process.execPath, ["--import", "tsx", "demo/server.ts"], {
  cwd: directory,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
for (const output of [server.stdout, server.stderr]) {
  output.on("data", (chunk) => {
    log = (log + chunk.toString()).slice(0, 8000);
  });
}
try {
  await waitUntilReady(server);
  await checkPaths();
  console.log(JSON.stringify({ variant, passed: true, results }));
} catch (error) {
  console.log(
    JSON.stringify({
      variant,
      passed: false,
      results,
      error: String(error),
      log,
    }),
  );
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}

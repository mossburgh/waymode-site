import { readFile, stat } from "node:fs/promises";

const required = [
  "public/index.html",
  "public/install/index.html",
  "public/favicon.svg",
  "public/robots.txt",
  "public/sitemap.xml",
  "public/_headers",
];

await Promise.all(required.map((path) => stat(path)));

const home = await readFile("public/index.html", "utf8");
const install = await readFile("public/install/index.html", "utf8");

const failures = [
  [!home.includes("Put your product in Waymode."), "home headline is missing"],
  [!home.includes('href="/install"'), "install link is missing"],
  [home.includes("Waymode design prototype"), "prototype label is still public"],
  [home.includes("https://github.com/\""), "placeholder GitHub link is still public"],
  [!install.includes("Install Waymode in this repository"), "agent prompt is missing"],
].filter(([failed]) => failed);

if (failures.length) {
  for (const [, message] of failures) console.error(`FAIL: ${message}`);
  process.exit(1);
}

console.log(`Checked ${required.length} production files.`);

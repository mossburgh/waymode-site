import { readFile, stat } from "node:fs/promises";
import assert from "node:assert/strict";

const required = [
  "public/index.html",
  "public/favicon.svg",
  "public/robots.txt",
  "public/sitemap.xml",
  "public/_headers",
  "public/_redirects",
];

await Promise.all(required.map((path) => stat(path)));

const home = await readFile("public/index.html", "utf8");
const sitemap = await readFile("public/sitemap.xml", "utf8");
const canonical = home.match(/rel="canonical" href="([^"]+)"/)?.[1];
const structuredData = home.match(
  /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
)?.[1];
const source = JSON.parse(structuredData ?? "null");
const socialImage = home.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
const twitterImage = home.match(
  /name="twitter:image"\s+content="([^"]+)"/,
)?.[1];
assert.ok(socialImage, "sharing image is missing");
assert.equal(twitterImage, socialImage, "sharing image URLs must agree");
const imageUrl = new URL(socialImage);
assert.equal(imageUrl.origin, "https://waymode.ai");
const image = await readFile(`public${imageUrl.pathname}`);
assert.equal(image.subarray(1, 4).toString(), "PNG");
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);

const failures = [
  [!home.includes("Put your product in Waymode."), "home headline is missing"],
  [!home.includes('href="#install-a"'), "install link is missing"],
  [
    home.includes("Waymode design prototype"),
    "prototype label is still public",
  ],
  [
    home.includes('https://github.com/"'),
    "placeholder GitHub link is still public",
  ],
  [
    !home.includes("Install Waymode in this repository"),
    "agent prompt is missing",
  ],
  [
    !home.includes("https://github.com/mossburgh/waymode"),
    "Waymode GitHub source is missing from the agent prompt",
  ],
  [
    !canonical || !sitemap.includes(`<loc>${canonical}</loc>`),
    "canonical URL must appear in the sitemap",
  ],
  [
    source?.url !== canonical || source?.["@type"] !== "SoftwareSourceCode",
    "structured source metadata must describe this site",
  ],
  [
    !home.includes('<main id="main-content">'),
    "primary content must be served in the HTML",
  ],
  [
    home.includes("setupStoryDriver") || home.includes('class="story-driver"'),
    "decorative agent playback must not obscure the real showcase",
  ],
  [
    !home.includes('src="/showcase/studio.html"'),
    "real showcase iframe is missing",
  ],
  [
    !home.includes('id="computer-use"'),
    "computer-use explanation is missing from the HTML",
  ],
  [
    !home.includes('id="questions"'),
    "integration answers are missing from the HTML",
  ],
].filter(([failed]) => failed);

if (failures.length) {
  for (const [, message] of failures) {
    console.error(`FAIL: ${message}`);
  }
  process.exit(1);
}

console.log(`Checked ${required.length} production files.`);

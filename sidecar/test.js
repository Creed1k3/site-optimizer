import { test } from "node:test";
import assert from "node:assert";

// Replicate ASSET_REF_RE from optimizer.js
const ASSET_REF_RE = /(?:src|href|poster|content|data-src|data-original|data-image|data-lazy-src|srcset|imagesrcset|data-srcset)\s*=\s*["']([^"']+\.(?:png|jpe?g|gif|webp|avif|mp4|ogv|webm|woff2?|ttf|otf|eot|css|m?js|cjs)(?:[?#][^"']*)?)["']|url\(\s*['"]?([^'")]+\.(?:png|jpe?g|gif|webp|avif|mp4|ogv|webm|woff2?|ttf|otf|eot|css|m?js|cjs)(?:[?#][^'")]+)?)['"]?\s*\)|(?:["'`(\s=:/\\,]|^)([^"'`\s),]+?\.(?:png|jpe?g|gif|webp|avif|mp4|ogv|webm|woff2?|ttf|otf|eot|css|m?js|cjs)(?:[?#][^"'`\s),]*)?)/gi;

function extractAssets(content) {
  const assets = [];
  let match;
  ASSET_REF_RE.lastIndex = 0;
  while ((match = ASSET_REF_RE.exec(content)) !== null) {
    const path = match[1] || match[2] || match[3];
    if (path && !path.startsWith("http://") && !path.startsWith("https://")) {
      assets.push(path);
    }
  }
  return assets;
}

test("ASSET_REF_RE: standard src attribute", () => {
  const html = '<img src="images/logo.png">';
  const assets = extractAssets(html);
  assert.deepStrictEqual(assets, ["images/logo.png"]);
});

test("ASSET_REF_RE: href link", () => {
  const html = '<a href="styles/main.css">Link</a>';
  const assets = extractAssets(html);
  assert.deepStrictEqual(assets, ["styles/main.css"]);
});

test("ASSET_REF_RE: srcset attribute", () => {
  const html = '<img srcset="img.png 1x, img@2x.webp 2x">';
  const assets = extractAssets(html);
  assert(assets.includes("img.png"));
  assert(assets.includes("img@2x.webp"));
});

test("ASSET_REF_RE: CSS url()", () => {
  const css = 'background: url("images/bg.jpg")';
  const assets = extractAssets(css);
  assert.deepStrictEqual(assets, ["images/bg.jpg"]);
});

test("ASSET_REF_RE: CSS url() without quotes captures context", () => {
  const css = "background: url(images/bg.png)";
  const assets = extractAssets(css);
  assert(assets.some(a => a.includes("images/bg.png")));
});

test("ASSET_REF_RE: query string and hash preservation", () => {
  const html = '<img src="image.png?v=1#section">';
  const assets = extractAssets(html);
  assert.deepStrictEqual(assets, ["image.png?v=1#section"]);
});

test("ASSET_REF_RE: relative paths with ../ and ./", () => {
  const html = '<img src="../images/logo.png"> <img src="./assets/icon.svg.webp">';
  const assets = extractAssets(html);
  assert(assets.includes("../images/logo.png"));
  assert(assets.includes("./assets/icon.svg.webp"));
});

test("ASSET_REF_RE: absolute paths /assets/", () => {
  const html = '<img src="/assets/image.jpg">';
  const assets = extractAssets(html);
  assert.deepStrictEqual(assets, ["/assets/image.jpg"]);
});

test("ASSET_REF_RE: protocol URLs excluded", () => {
  const html = '<img src="https://cdn.example.com/image.png"> <img src="image.local.png">';
  const assets = extractAssets(html);
  assert(!assets.includes("https://cdn.example.com/image.png"));
  assert.deepStrictEqual(assets, ["image.local.png"]);
});

test("ASSET_REF_RE: dynamic import paths captured (cannot distinguish)", () => {
  const js = 'import("./module.js").then(m => m.default)';
  const assets = extractAssets(js);
  assert(assets.includes("./module.js"));
});

test("ASSET_REF_RE: data URI ignored", () => {
  const html = '<img src="data:image/png;base64,iVBORw0...">';
  const assets = extractAssets(html);
  assert(!assets.includes("data:image/png;base64,iVBORw0..."));
});

test("ASSET_REF_RE: video mp4 and webm", () => {
  const html = '<video src="video.mp4" poster="thumb.webp"></video>';
  const assets = extractAssets(html);
  assert(assets.includes("video.mp4"));
  assert(assets.includes("thumb.webp"));
});

test("ASSET_REF_RE: font files", () => {
  const css = '@font-face { src: url("fonts/montserrat.woff2"), url("fonts/fallback.ttf"); }';
  const assets = extractAssets(css);
  assert(assets.includes("fonts/montserrat.woff2"));
  assert(assets.includes("fonts/fallback.ttf"));
});

test("ASSET_REF_RE: AVIF image format", () => {
  const html = '<img src="images/photo.avif" alt="Photo">';
  const assets = extractAssets(html);
  assert.deepStrictEqual(assets, ["images/photo.avif"]);
});

test("ASSET_REF_RE: multiple assets in one line", () => {
  const html = '<img src="a.png"> <script src="b.js"></script> <link rel="stylesheet" href="c.css">';
  const assets = extractAssets(html);
  assert(assets.includes("a.png"));
  assert(assets.includes("b.js"));
  assert(assets.includes("c.css"));
});

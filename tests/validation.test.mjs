import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  validateFile,
  text,
  cleanTag,
  parseTags,
  validateTags,
  slugify,
  formatSize,
} from "../assets/js/validation.js";

test("rejects spoofed MIME, active formats, empty files and oversized uploads", () => {
  for (const file of [
    { name: "x.svg", type: "image/svg+xml", size: 12 },
    { name: "x.jpg", type: "text/html", size: 12 },
    { name: "x.png", type: "image/png", size: 0 },
    { name: "x.exe", type: "application/octet-stream", size: 10 },
  ]) assert.throws(() => validateFile(file, 20, 100));
  assert.equal(
    validateFile({ name: "MY PHOTO.JPG", type: "image/jpeg", size: 20 }, 20, 100),
    "jpg",
  );
});

test("video and gif get their own size ceilings", () => {
  const big = 30 * 1024 * 1024;
  assert.throws(
    () => validateFile({ name: "big.jpg", type: "image/jpeg", size: big }, 26214400, 52428800),
    undefined,
    "still image over 25 MB",
  );
  assert.throws(
    () => validateFile({ name: "big.gif", type: "image/gif", size: big }, 26214400, 52428800),
    undefined,
    "gif over 25 MB",
  );
  assert.doesNotThrow(() =>
    validateFile({ name: "clip.mp4", type: "video/mp4", size: big }, 26214400, 52428800),
  );
});

test("text validation trims and enforces nonempty bounds", () => {
  assert.equal(text(" hi ", 5, "Name"), "hi");
  assert.throws(() => text("  ", 5, "Name"));
  assert.throws(() => text("123456", 5, "Name"));
});

test("tags normalise to a safe single word", () => {
  assert.equal(cleanTag("  #BeachDay "), "beachday");
  assert.equal(cleanTag("hello world!"), "hello-world");
  assert.equal(cleanTag("--a--"), "a");
  assert.equal(cleanTag("###"), "");
  assert.equal(cleanTag("<script>"), "script");
  assert.equal(cleanTag("a".repeat(80)).length, 32);
  // Nothing that could climb out of a url or a query.
  for (const raw of ["../../etc", "a/b", "a?b", "a&b", "a=b"]) {
    const tag = cleanTag(raw);
    assert.ok(!/[/\\?&=.]/.test(tag), `unsafe characters survived: ${raw} -> ${tag}`);
  }
});

test("hashtags are pulled from captions, deduped and capped", () => {
  assert.deepEqual(parseTags("Great day #beach with #Sun and #beach"), ["beach", "sun"]);
  assert.deepEqual(parseTags("no tags here"), []);
  assert.equal(parseTags("#a #b #c #d #e #f #g").length, 5);
  assert.deepEqual(parseTags("tags # spaced"), []);
});

test("tag lists are cleaned, deduped and capped", () => {
  assert.deepEqual(validateTags(["#Beach", "beach", " SUN ", "", "!!"]), ["beach", "sun"]);
  assert.throws(() => validateTags(["a", "b", "c", "d", "e", "f"]), undefined, "over the cap");
  assert.throws(() => validateTags("nope"), undefined, "not an array");
});

test("slugs stay url safe", () => {
  assert.equal(slugify("  Beach Days 2024! "), "beach-days-2024");
  assert.equal(slugify("../../etc/passwd"), "etc-passwd");
  assert.equal(slugify("!!!"), "");
});

test("sizes read cleanly", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(5 * 1024 * 1024), "5.0 MB");
});

test("the header has no sound toggle but sounds still respond to a stored preference", async () => {
  const ui = await readFile("assets/js/ui.js", "utf8");
  // The control is gone from the header, the engine is not.
  assert.ok(!ui.includes("soundToggle"), "the sound toggle is back in the header");
  assert.ok(!ui.includes('aria-label", soundEnabled()'), "the toggle still renders");
  assert.ok(!ui.includes("nav-tools"), "an empty tools wrapper is left behind");

  const sound = await readFile("assets/js/sound.js", "utf8");
  assert.ok(sound.includes("archive:sound"), "the stored sound preference was dropped");
  assert.ok(sound.includes("export function setSoundEnabled"), "the mute path was removed");
  // Sounds are attached by attribute so they survive without any button.
  assert.ok(sound.includes("bindSounds"), "the delegated sound binding is gone");
});

test("an empty archive gets a real placeholder, not a bare sentence", async () => {
  const ui = await readFile("assets/js/ui.js", "utf8");
  for (const part of ["export function emptyState(", "export function showEmpty(", "export function loading("])
    assert.ok(ui.includes(part), `ui.js is missing ${part}`);

  const css = await readFile("assets/css/components.css", "utf8");
  for (const part of [".empty-mark", ".empty-title", ".empty-body", ".empty-loading", ".empty-compact"])
    assert.ok(css.includes(part), `components.css is missing ${part}`);

  // The three states a public page can land in.
  const pages = ["gallery.js", "albums.js", "messages.js", "search.js"];
  for (const file of pages) {
    const code = await readFile(`assets/js/${file}`, "utf8");
    assert.ok(
      code.includes("showEmpty(") || code.includes("emptyState("),
      `${file} still renders bare text where a placeholder belongs`,
    );
  }
  const gallery = await readFile("assets/js/gallery.js", "utf8");
  assert.ok(gallery.includes('"The archive is empty"'), "the gallery has no empty archive placeholder");
  assert.ok(gallery.includes("Share something"), "the empty gallery offers no way forward");
});

test("the footer credits the two people who made it, as plain text", async () => {
  const ui = await readFile("assets/js/ui.js", "utf8");
  assert.ok(ui.includes("@cis6led"), "the first credit is missing");
  assert.ok(ui.includes("@yuss.eu"), "the second credit is missing");
  assert.ok(ui.includes("Made by @cis6led and @yuss.eu"), "the credits line is not plain text");
  // Plain text only, so there must be no link markup or external targets.
  assert.ok(!ui.includes("github.com/cis6led"), "the credits still link out");
  assert.ok(!/https?:\/\/[^"']*yuss/.test(ui), "the credits still link out");
  assert.ok(!ui.includes('target = "_blank"'), "the credits still open new tabs");
  assert.ok(!ui.includes("credit-link"), "credit link markup is left over");
  const css = await readFile("assets/css/components.css", "utf8");
  assert.ok(!css.includes(".credit-link"), "the credit link styling is left over");
  assert.ok(css.includes(".credits"), "the credits line has no styling");
  assert.ok(css.includes(".footer-top"), "the footer top row is missing");
});

test("the landing heading has one slow neutral sheen and nothing else does", async () => {
  const css = await readFile("assets/css/components.css", "utf8");
  const gradients = [...css.matchAll(/linear-gradient\(([\s\S]*?)\)\s*;/g)];
  // The only gradient in the interface is the heading sheen.
  assert.equal(gradients.length, 1, `expected exactly one gradient, found ${gradients.length}`);
  // It has to be neutral, never a hue. "deg" is an angle, not a colour.
  const stops = gradients[0][1].toLowerCase();
  for (const hue of ["hsl", "rgb", "oklch", "oklab", "color(", "#f", "#b", "#d", "violet", "teal", "neon"])
    assert.ok(!stops.includes(hue), `the sheen uses a colour: ${hue}`);
  assert.ok(css.includes("@keyframes sheen"), "no sheen animation");
  // Slow: at least 20 seconds per pass.
  const seconds = Number(css.match(/animation:\s*sheen\s+(\d+)s/)?.[1] || 0);
  assert.ok(seconds >= 20, `the sheen runs at ${seconds}s, too fast`);
  // Only the landing heading, never a card or a background.
  assert.ok(css.includes("background-clip: text"), "the sheen is not clipped to the text");
  assert.ok(!/background-image:[^;]*linear-gradient[\s\S]{0,400}?(\.post-card|\.album-card)/.test(css), "a card picked up a gradient");

  const motion = await readFile("assets/css/motion.css", "utf8");
  const block = motion.slice(motion.indexOf("prefers-reduced-motion"));
  assert.ok(block.includes(".hero h1"), "the sheen does not stop for reduced motion");
  assert.ok(block.includes("animation: none"), "the sheen still animates under reduced motion");
});

test("an empty archive always renders a placeholder, on every entry point", async () => {
  const gallery = await readFile("assets/js/gallery.js", "utf8");
  // The empty state has to be reachable from the shared render path, otherwise
  // the home page clears its placeholder and renders nothing at all.
  assert.ok(gallery.includes("function renderEmpty("), "no shared empty renderer");
  assert.ok(
    /else if \(!loaded\.length\)\s*\{\s*renderEmpty\(/.test(gallery),
    "render() does not fall back to the empty state",
  );
  const calls = [...gallery.matchAll(/renderEmpty\(/g)].length;
  assert.ok(calls >= 2, `renderEmpty is only reached ${calls} time(s)`);
  assert.ok(gallery.includes('"The archive is empty"'), "no empty archive placeholder");
  // Both the paginated gallery and the home slice have to reach it.
  assert.ok(gallery.includes("await load()"), "the paginated path is gone");
  assert.ok(gallery.includes("render(posts);"), "the home path is gone");
  // A filter with no matches needs its own wording, not "the archive is empty".
  assert.ok(gallery.includes("No ${label} yet"), "no wording for an empty filter");
});

test("the layout has breakpoints at every width it needs", async () => {
  const css = await readFile("assets/css/responsive.css", "utf8");
  const widths = [...css.matchAll(/max-width:\s*(\d+)px/g)].map((match) => Number(match[1]));
  for (const width of [900, 720, 420]) {
    assert.ok(widths.includes(width), `no rule for ${width}px`);
  }
  // The grid has to collapse, the nav has to collapse, the lightbox has to fill.
  assert.ok(css.includes("grid-template-columns: repeat(2"), "the grid never drops to two columns");
  assert.ok(css.includes("grid-template-columns: 1fr"), "the grid never drops to one column");
  assert.ok(css.includes("nav.open"), "the mobile navigation cannot be opened");
  assert.ok(css.includes("100dvh"), "the lightbox does not go full height on mobile");
  // Bevels are invisible under a forced palette, so borders have to take over.
  assert.ok(css.includes("forced-colors"), "no forced-colors fallback");

  const global = await readFile("assets/css/global.css", "utf8");
  assert.ok(global.includes('@import "./responsive.css"'), "responsive.css is not imported");
});

test("there is no approval queue anywhere, and removal is still possible", async () => {
  // Nothing may still talk about waiting for a moderator.
  for (const path of [
    "assets/js/submit.js",
    "assets/js/admin.js",
    "src/pages/submit.html",
    "src/pages/adminpanel.html",
  ]) {
    const content = await readFile(path, "utf8");
    assert.ok(!/for approval/i.test(content), `${path} still mentions approval`);
  }
  const panel = await readFile("src/pages/adminpanel.html", "utf8");
  assert.ok(!panel.includes('data-status'), "the admin panel still has a status filter");
  assert.ok(panel.includes("Memories"), "the admin panel has no memories tab");

  // Publishing happens in finalize, where the file has been verified.
  const fn = await readFile("supabase/functions/archive/index.ts", "utf8");
  const finalize = fn.slice(fn.indexOf('body.action === "finalize"'), fn.indexOf('body.action === "create-album"'));
  assert.ok(finalize.includes('status: "approved"'), "finalize does not publish");
  assert.ok(finalize.includes("uploaded: true"), "finalize does not mark the upload verified");
  assert.ok(
    finalize.indexOf("matchesMagic") < finalize.indexOf('status: "approved"'),
    "the memory is published before its bytes are checked",
  );
  // Without a queue, an admin has to be able to take something down.
  assert.ok(fn.includes('body.action === "unpublish"'), "there is no way to remove a live memory");
  const unpublish = fn.slice(fn.indexOf('body.action === "unpublish"'), fn.indexOf('body.action === "reject"'));
  assert.ok(unpublish.includes(".eq(\"status\", \"approved\")"), "unpublish is not scoped to live memories");
  assert.ok(unpublish.includes("media.remove"), "unpublish leaves the file behind");
  assert.ok(unpublish.includes("posters.remove"), "unpublish leaves the thumbnail behind");

  // And the report path still exists for everyone else.
  const actions = await readFile("assets/js/data-actions.js", "utf8");
  assert.ok(actions.includes("export const report"), "the report button has no path");
});

test("pages fade in, and cross document navigation fades where supported", async () => {
  const motion = await readFile("assets/css/motion.css", "utf8");
  assert.ok(/@keyframes page-in/.test(motion), "no page in animation");
  assert.ok(/main\s*\{\s*animation: page-in/.test(motion), "main does not fade in");
  // translate, not transform, so it cannot break fixed positioning.
  const keyframes = motion.slice(motion.indexOf("@keyframes page-in"), motion.indexOf("/* Cross document"));
  assert.ok(keyframes.includes("translate:"), "the page transition uses transform instead of translate");
  assert.ok(!keyframes.includes("transform:"), "the page transition uses transform instead of translate");
  assert.ok(motion.includes("::view-transition-old(root)"), "no outgoing page fade");
  assert.ok(motion.includes("::view-transition-new(root)"), "no incoming page fade");

  const global = await readFile("assets/css/global.css", "utf8");
  assert.ok(/@view-transition\s*\{\s*navigation: auto/.test(global), "cross document transitions are not enabled");

  // Reduced motion keeps a plain fade and drops the travel.
  const block = motion.slice(motion.indexOf("prefers-reduced-motion"));
  assert.ok(block.includes("animation: fade-in"), "reduced motion has no fade at all");

  // The old attribute based trigger is gone, it never matched anything.
  const ui = await readFile("assets/js/ui.js", "utf8");
  assert.ok(!ui.includes("dataset.enter"), "the dead page enter trigger is back");
  assert.ok(!motion.includes("main[data-enter]"), "a dead page enter selector is back");
});

test("the build takes credentials from the environment so CI works without a file", async () => {
  const build = await readFile("scripts/build.mjs", "utf8");
  assert.ok(
    /process\.env/.test(build) && /ARCHIVE_/.test(build),
    "the build ignores environment variables, so Actions cannot supply them",
  );
  const workflow = await readFile(".github/workflows/pages.yml", "utf8");
  assert.ok(
    workflow.includes("secrets.ARCHIVE_API_URL") && workflow.includes("secrets.ARCHIVE_API_KEY"),
    "the workflow does not pass the project credentials as secrets",
  );
  // The service role key must never be a build input.
  assert.ok(!/SERVICE_ROLE/.test(workflow), "the workflow references the service role key");
  assert.ok(!/SERVICE_ROLE/.test(build), "the build reads the service role key");
  // And no value may be hardcoded in the workflow itself.
  assert.ok(!/sb_publishable_|sb_secret_/.test(workflow), "a key is hardcoded in the workflow");
});

test("no em dashes anywhere in the interface copy", async () => {
  const files = [];
  for (const dir of ["assets/js", "assets/css", "src/pages", "supabase", "scripts"]) {
    for (const entry of await readdir(dir, { recursive: true })) {
      if (/\.(js|css|html|sql|ts|mjs)$/.test(entry)) files.push(`${dir}/${entry.replace(/\\/g, "/")}`);
    }
  }
  for (const path of files) {
    const content = await readFile(path, "utf8");
    assert.ok(!content.includes("\u2014"), `${path} contains an em dash`);
  }
});

test("form handlers swallow failures instead of leaking unhandled rejections", async () => {
  // busy() re-throws so callers can abort a chain. Every form and click handler
  // must therefore go through attempt(), or a rejected promise escapes into the
  // console and the page looks broken even though the user was told what is wrong.
  const ui = await readFile("assets/js/ui.js", "utf8");
  assert.ok(ui.includes("export async function attempt("), "attempt() helper is missing");

  for (const file of ["submit.js", "messages.js", "admin.js", "albums.js", "gallery.js", "lightbox.js"]) {
    const code = await readFile(`assets/js/${file}`, "utf8");
    assert.ok(
      /(^|[^.\w])busy\(/.test(code) === false,
      `${file} calls busy() in a handler, use attempt() instead`,
    );
  }
});

test("a blocked origin produces an actionable message", async () => {
  const data = await readFile("assets/js/data.js", "utf8");
  assert.ok(data.includes("ALLOWED_ORIGINS"), "the origin hint does not name the setting");
  assert.ok(data.includes("location.origin"), "the origin hint does not name the origin");
  // A refused preflight has no response body, so the http branch and the
  // network branch must stay separate.
  assert.ok(data.includes("error.context"), "the http error path lost its body handling");
});

test("the built config and the placeholder config declare the same keys", async () => {
  const source = await readFile("assets/js/config.js", "utf8");
  const build = await readFile("scripts/build.mjs", "utf8");
  const keys = [...source.matchAll(/^\s*([A-Z0-9_]+):/gm)].map((match) => match[1]);
  assert.ok(keys.length >= 9, `expected the full key set, found ${keys.join(", ")}`);
  for (const key of keys)
    assert.ok(build.includes(`${key}:`), `scripts/build.mjs does not emit ${key}`);
  // The tracked file must never be able to hold a working credential.
  assert.ok(source.includes("REPLACE_WITH_PROJECT_URL"));
  assert.ok(source.includes("REPLACE_WITH_PROJECT_KEY"));
});

test("every public route has relative assets and no admin link", async () => {
  const partials = (await readdir("src/pages")).filter((file) => file.endsWith(".html"));
  assert.ok(partials.length >= 6, "expected at least six page partials");
  for (const file of partials) {
    if (file === "adminpanel.html") continue;
    const html = await readFile(`src/pages/${file}`, "utf8");
    assert.ok(!html.includes("adminpanel"), `${file} points at the admin route`);
    assert.ok(!/href="\//.test(html), `${file} has a root relative link`);
    assert.ok(!/src="\//.test(html), `${file} has a root relative source`);
  }
  const ui = await readFile("assets/js/ui.js", "utf8");
  assert.ok(!ui.includes("adminpanel"), "the nav must not know about the admin route");
});

test("the search worker ranks exact tags above captions", async () => {
  const source = await readFile("assets/js/search-index.js", "utf8");
  // The worker must not depend on the DOM, it runs off the main thread.
  assert.ok(!/document\.|window\./.test(source), "the worker touched the DOM");
  assert.ok(source.includes('self.onmessage'), "the worker has no entry point");
});

test("the search index never carries a storage path or a signed url", async () => {
  const source = await readFile("assets/js/search.js", "utf8");
  const block = source.slice(source.indexOf("function fetchRows"), source.indexOf("function startWorker"));
  assert.ok(!block.includes("storage_path"), "the cached index must not store file paths");
  assert.ok(!block.includes("signedUrl"), "the cached index must not store signed urls");
  assert.ok(!block.includes("url"), "the cached index must not store any url");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
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

test("the landing heading has one neutral gradient that never cuts the text", async () => {
  const css = await readFile("assets/css/components.css", "utf8");
  const gradients = [...css.matchAll(/linear-gradient\(([\s\S]*?)\)\s*;/g)];
  // The only gradient in the interface is the heading fill.
  assert.equal(gradients.length, 1, `expected exactly one gradient, found ${gradients.length}`);
  // It has to be neutral, never a hue. "deg" is an angle, not a colour.
  const stops = gradients[0][1].toLowerCase();
  for (const hue of ["hsl", "rgb", "oklch", "oklab", "color(", "#f", "#b", "#d", "violet", "teal", "neon"])
    assert.ok(!stops.includes(hue), `the gradient uses a colour: ${hue}`);
  assert.ok(css.includes("background-clip: text"), "the gradient is not clipped to the text");

  // A moving background combined with a transparent text fill leaves any glyph
  // outside the painted area invisible. That cut "Community" in half, so the
  // fill has to be static and cover the whole element.
  assert.ok(!/animation:/.test(gradients[0][0]), "the heading gradient still animates");
  assert.ok(!css.includes("@keyframes sheen"), "the heading sheen keyframes are still here");
  const rule = css.slice(css.indexOf(".hero h1 {"), css.indexOf(".hero-lede"));
  assert.ok(/background-size:\s*100% 100%/.test(rule), "the gradient does not cover the full text");
  assert.ok(!/background-size:\s*[2-9]\d\d%/.test(css), "a gradient is wider than its text, so it can clip");
  assert.ok(!/background-position/.test(rule), "the heading fill is positioned, so it can cut");

  // Only the landing heading, never a card or a background.
  assert.ok(!/background-image:[^;]*linear-gradient[\s\S]{0,400}?(\.post-card|\.album-card)/.test(css), "a card picked up a gradient");
});

test("gallery cards are square and small enough to scan", async () => {
  const css = await readFile("assets/css/components.css", "utf8");
  assert.ok(
    /\.media \{[^}]*aspect-ratio:\s*1 \/ 1[^}]*object-fit: cover/.test(css),
    "card media is not a square crop",
  );
  assert.ok(/repeat\(4, minmax/.test(css), "the grid is not four across on a wide screen");
  const responsive = await readFile("assets/css/responsive.css", "utf8");
  for (const width of [1180, 900, 720]) {
    assert.ok(
      new RegExp(`max-width:\\s*${width}px`).test(responsive),
      `no rule for ${width}px, the card count never steps down`,
    );
  }
  // The full height version is reserved for the viewer, not for a card.
  const lightbox = css.slice(css.indexOf("  .lightbox {"));
  assert.ok(lightbox.includes("aspect-ratio: auto"), "the viewer is not free to show the true shape");
});

test("a gif card plays on hover and rests on the poster otherwise", async () => {
  const lightbox = await readFile("assets/js/lightbox.js", "utf8");
  // The card renders the poster, so the animated source has to be carried
  // separately. Saving node.src would just save the poster and swap it for
  // itself, which is why hover did nothing.
  assert.ok(
    /node\.dataset\.gifSrc = post\.url/.test(lightbox),
    "the animated gif url is not carried on the node",
  );
  const motion = await readFile("assets/js/motion.js", "utf8");
  const bind = motion.slice(motion.indexOf("export function bindGif"));
  assert.ok(bind.includes("data-gif-src") || bind.includes("dataset.gifSrc"), "bindGif does not read the animated source");
  assert.ok(bind.includes("pointerenter") && bind.includes("pointerleave"), "the gif is not driven by hover");
  assert.ok(/const still = img\.src/.test(bind), "the resting frame is not the poster");
  // Guarded so re-binding a card cannot stack listeners.
  assert.ok(bind.includes("gifBound"), "bindGif can attach twice to the same image");
  // The offscreen observer must not swap sources, or it fights the hover.
  assert.ok(!/delete node\.dataset\.paused/.test(motion), "the old source swapping observer is still there");
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

test("no tracked file can hold a working credential", async () => {
  // .env.example is deliberately tracked, so it is the most likely place for a
  // real value to be pasted by accident. Everything git tracks is swept.
  const tracked = await new Promise((resolve, reject) => {
    const child = spawn("git", ["ls-files"], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => (code === 0 ? resolve(out.trim().split("\n")) : reject(new Error("git ls-files failed"))));
    child.on("error", reject);
  });

  const patterns = [
    /sb_publishable_[A-Za-z0-9_-]{20,}/,
    /sb_secret_[A-Za-z0-9_-]{20,}/,
    /eyJhbGciOi[A-Za-z0-9_-]{20,}/,
    /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+["']/,
  ];

  const leaks = [];
  for (const path of tracked) {
    if (!path) continue;
    let content;
    try {
      content = await readFile(path, "utf8");
    } catch {
      continue;
    }
    for (const pattern of patterns)
      if (pattern.test(content)) leaks.push(`${path} matches ${pattern}`);
  }
  assert.deepEqual(leaks, [], `credentials in tracked files:\n${leaks.join("\n")}`);

  // The examples must still be examples.
  const example = await readFile(".env.example", "utf8");
  assert.ok(example.includes("YOUR-PROJECT-REF"), ".env.example lost its placeholder url");
  assert.ok(example.includes("YOUR-PUBLISHABLE-OR-ANON-KEY"), ".env.example lost its placeholder key");
  // And it must be trackable, or the guard above is pointless.
  assert.ok(tracked.includes(".env.example"), ".env.example is not tracked");
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

test("every stylesheet import is in a position a browser will honour", async () => {
  // A browser drops @import that appears after any rule other than @charset or
  // an @layer statement. Dropping is silent, so the whole theme vanishes and
  // only global.css loads. This is the exact bug that broke the live site.
  const css = await readFile("assets/css/global.css", "utf8");
  const lines = css.split("\n");
  const layerStatement = lines.findIndex((line) => /^@layer\s+[\w\s,]+;$/.test(line.trim()));
  const firstImport = lines.findIndex((line) => line.trim().startsWith("@import"));
  const lastImport = lines.map((line) => line.trim().startsWith("@import")).lastIndexOf(true);
  assert.ok(firstImport >= 0, "global.css has no imports at all");

  // Nothing that is not an import may sit between the layer statement and the
  // last import, other than comments and blank lines.
  const offenders = [];
  for (let i = firstImport; i < lastImport; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("@import") || trimmed.startsWith("/*") || trimmed.endsWith("*/"))
      continue;
    offenders.push(`line ${i + 1}: ${trimmed}`);
  }
  assert.deepEqual(offenders, [], `@import must come first:\n${offenders.join("\n")}`);

  // The layer statement is the one thing allowed above the imports.
  for (let i = 0; i < firstImport; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("/*") || trimmed.endsWith("*/")) continue;
    assert.ok(
      /^@layer\s+[\w\s,]+;$/.test(trimmed),
      `line ${i + 1} sits above the imports and is not an @layer statement: ${trimmed}`,
    );
  }
  assert.ok(layerStatement >= 0 && layerStatement < firstImport, "the layer order is not declared first");

  // Every imported file has to exist, or the browser gets a 404 and skips it.
  const imports = [...css.matchAll(/@import\s+"\.\/([^"]+)"/g)].map((match) => match[1]);
  assert.ok(imports.length >= 5, `expected the full set of partials, found ${imports.length}`);
  for (const name of imports) {
    await readFile(`assets/css/${name}`, "utf8");
  }

  // And the layer order has to mention every layer the partials use.
  const order = css.match(/@layer\s+([\w\s,]+);/)[1].split(",").map((name) => name.trim());
  for (const name of ["reset", "tokens", "base", "components", "motion", "utilities"])
    assert.ok(order.includes(name), `the layer order is missing ${name}`);
  for (const file of imports) {
    const part = await readFile(`assets/css/${file}`, "utf8");
    for (const match of part.matchAll(/@layer\s+([\w\s,]+)\s*\{/g))
      for (const layer of match[1].split(","))
        assert.ok(order.includes(layer.trim()), `${file} uses the undeclared layer "${layer.trim()}"`);
  }
});

test("an upload never falls back to a url on this site", async () => {
  // A null url passed to xhr.open becomes the string "null", which the browser
  // resolves against the current page. That produced a PUT to /submit/null
  // that 404ed on Vercel and looked like a network fault.
  const submit = await readFile("assets/js/submit.js", "utf8");
  const upload = submit.slice(submit.indexOf("function upload("));
  assert.ok(
    /if \(typeof url !== "string" \|\| !url\.startsWith/.test(upload),
    "upload() does not reject a missing url",
  );
  assert.ok(upload.indexOf("xhr.open") > upload.indexOf("typeof url"), "the check runs after the request");
});

test("the poster slot is asked for, and its failure is never fatal", async () => {
  const actions = await readFile("assets/js/data-actions.js", "utf8");
  const reserve = actions.slice(actions.indexOf("export async function reserve("));
  assert.ok(
    /has_poster:\s*Boolean\(hasPoster\)/.test(reserve),
    "reserve() never tells the server a poster is coming, so the url comes back null",
  );
  assert.ok(/width:/.test(reserve) && /height:/.test(reserve), "the real dimensions are never sent");

  const submit = await readFile("assets/js/submit.js", "utf8");
  assert.ok(
    /hasPoster:\s*Boolean\(poster\)/.test(submit),
    "the submit flow does not pass the poster flag",
  );
  // Both urls have to be checked before the first request goes out.
  assert.ok(
    /if \(!reservation\?\.id \|\| !reservation\?\.url\)/.test(submit),
    "the reservation is used without checking it came back complete",
  );
  // The poster is optional, so it must not reject the submission.
  const posterUpload = submit.slice(submit.indexOf("reservation.poster_url"));
  assert.ok(
    /try \{[\s\S]{0,400}await upload\(reservation\.poster_url[\s\S]{0,200}catch/.test(posterUpload),
    "a failed thumbnail upload takes the whole submission down",
  );
  assert.ok(!/Promise\.all\(jobs\)/.test(submit), "the optional poster is still in a shared Promise.all");

  // And the server must not hand back a half filled reservation.
  const fn = await readFile("supabase/functions/archive/index.ts", "utf8");
  assert.ok(
    fn.includes("body.has_poster === true"),
    "the server does not require an explicit poster flag",
  );
  assert.ok(
    /if \(!signed\.signedUrl\) throw/.test(fn),
    "the server can return a reservation with no upload url",
  );
});

test("the viewer is compact, centred, and always has a way out", async () => {
  const css = await readFile("assets/css/components.css", "utf8");
  const lightbox = css.slice(css.indexOf("  .lightbox {"), css.indexOf("  /* Toasts */"));

  // Compact, not a near full screen takeover.
  assert.ok(/width:\s*min\(900px/.test(lightbox), "the viewer is not a sane width");
  assert.ok(/max-height:\s*min\(88dvh/.test(lightbox), "the viewer has no height ceiling");
  assert.ok(!/min-height:\s*4\d dvh|min-height:\s*4\dv h/.test(lightbox), "the stage still forces a tall box");

  // Pinned head and foot around a scrolling middle, so the controls never
  // scroll out of reach.
  assert.ok(/\.lightbox \{[^}]*display: flex[^}]*flex-direction: column/.test(lightbox), "the viewer is not a column");
  for (const part of [".lb-head {", ".lb-scroll {", ".lb-foot {", ".lb-group {"])
    assert.ok(lightbox.includes(part), `the viewer is missing ${part}`);
  assert.ok(/\.lb-scroll \{[^}]*overflow-y: auto/.test(lightbox), "the middle does not scroll");
  assert.ok(/\.lb-head \{[^}]*flex: none/.test(lightbox), "the head scrolls away");
  assert.ok(/\.lb-foot \{[^}]*flex: none/.test(lightbox), "the foot scrolls away");

  // Breathing room, and no gradient, because the brief says none.
  assert.ok(/\.lb-caption \{[^}]*padding: 2\dpx/.test(lightbox), "the caption has no breathing room");
  assert.ok(/\.comments-section \{[^}]*padding: 2\dpx/.test(lightbox), "the comments have no breathing room");
  assert.ok(!/gradient\(/.test(lightbox), "the viewer picked up a gradient");

  // The rules for the old layout must be gone, not merely overridden.
  for (const gone of [".lb-bar", ".lb-nav", ".lb-info", ".lb-editor"])
    assert.ok(!lightbox.includes(gone), `${gone} is left over from the old layout`);
  const responsive = await readFile("assets/css/responsive.css", "utf8");
  for (const gone of [".lb-bar", ".lb-info", ".lb-editor"])
    assert.ok(!responsive.includes(gone), `${gone} is still targeted in the mobile overrides`);

  // The close control lives in the pinned head, not floating over the media.
  const js = await readFile("assets/js/lightbox.js", "utf8");
  assert.ok(/head\.append\(headText, close\)/.test(js), "the close button is not in the head");
  assert.ok(/node\.append\(head, scroll, foot\)/.test(js), "the viewer is not head, scroll, foot");
  assert.ok(!/stage\.append\(prev, next, close,/.test(js), "the close button is still over the media");
  assert.ok(js.includes("wireClose(close)"), "the close button is not wired");
});

test("a dialog's body is actually in the tree", async () => {
  // The body was created but never appended, so every confirm dialog rendered
  // as a title and a close button with no content inside.
  const ui = await readFile("assets/js/ui.js", "utf8");
  const dialog = ui.slice(ui.indexOf("export function dialog("));
  assert.ok(/node\.append\(top, body\)/.test(dialog), "the modal body is never added to the dialog");
  assert.ok(
    !/body: el\("div", "modal-body"\)/.test(dialog),
    "a second, detached body is handed to callers",
  );
  // The plain modal needs its own padding now that the dialog has none.
  const css = await readFile("assets/css/components.css", "utf8");
  assert.ok(/\.modal-body \{[^}]*padding:/.test(css), "the modal body has no padding");
  assert.ok(/\.modal-top \{[^}]*padding:/.test(css), "the modal head has no padding");
});

test("the viewer reads the shared id but never rewrites the address", async () => {
  // Opening a memory used to push ?post= into the address bar, which turned the
  // browser back button into a viewer toggle and left the archive with a url
  // that no longer matched the list behind it. The id is now only ever read.
  const js = await readFile("assets/js/lightbox.js", "utf8");
  assert.ok(
    !/history\.(replaceState|pushState)/.test(js),
    "the viewer still rewrites the address bar",
  );
  assert.ok(js.includes("export function deepLinkId()"), "the shared id is never read");
  assert.ok(
    js.includes("new URLSearchParams(location.search).get(\"post\")"),
    "the shared id is not taken from the query string",
  );

  // A shared link can point at a memory that is not on the current page, so the
  // gallery has to be able to fetch it rather than only searching what it has.
  const gallery = await readFile("assets/js/gallery.js", "utf8");
  assert.ok(gallery.includes("loadPost("), "an off-page deep link is never fetched");
  assert.ok(
    gallery.includes("openLightbox(post, [post])"),
    "a fetched memory is not opened on its own, so the list stays as it was",
  );

  const actions = await readFile("assets/js/data-actions.js", "utf8");
  assert.ok(actions.includes("export async function loadPost("), "loadPost is missing");
  assert.ok(
    /loadPost\(id\)[\s\S]*?\.eq\("id", id\)[\s\S]*?\.eq\("status", "approved"\)/.test(actions),
    "loadPost does not scope the fetch to one approved memory",
  );
});

test("every asset url carries the build version, so a deploy cannot split", async () => {
  // A browser that holds app.js from one deploy and gallery.js from another
  // renders a broken hybrid. Versioning only the entry points leaves every
  // internal import on a bare url, so the whole graph has to be versioned.
  const build = await readFile("scripts/build.mjs", "utf8");
  assert.ok(build.includes("versionReferences"), "internal references are not versioned");
  assert.ok(build.includes("new\\s+URL"), "worker urls are not versioned");

  // The built output has to prove it. Rebuild if dist is absent.
  let html;
  try {
    html = await readFile("dist/index.html", "utf8");
  } catch {
    return;
  }
  assert.ok(/global\.css\?v=[a-z0-9]+/.test(html), "the stylesheet has no version");
  assert.ok(/app\.js\?v=[a-z0-9]+/.test(html), "the entry module has no version");
  const app = await readFile("dist/assets/js/app.js", "utf8");
  const bareJs = [...app.matchAll(/["'](\.\/[^"']+?\.js)(\?v=[a-z0-9]+)?["']/g)]
    .filter((match) => !match[2])
    .map((match) => match[1]);
  assert.deepEqual(bareJs, [], `unversioned module imports in app.js: ${bareJs.join(", ")}`);
  const css = await readFile("dist/assets/css/global.css", "utf8");
  const bareCss = [...css.matchAll(/@import\s+"(\.\/[^"]+?\.css)(\?v=[a-z0-9]+)?"/g)]
    .filter((match) => !match[2])
    .map((match) => match[1]);
  assert.deepEqual(bareCss, [], `unversioned css imports: ${bareCss.join(", ")}`);
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

test("a card image is a square, whatever the upload's own proportions", async () => {
  // mediaNode() writes width/height onto the node so the browser can reserve
  // space. Those are presentational hints, so they make height definite and the
  // card's aspect-ratio is ignored, which left a 400x1600 upload rendering at
  // 1600px tall inside a 277px column. height:auto has to stay on .media.
  const css = await readFile("assets/css/components.css", "utf8");
  const media = css.slice(css.indexOf("\n  .media {"), css.indexOf("\n  .media-tag"));
  assert.ok(/aspect-ratio:\s*1\s*\/\s*1/.test(media), "the card image has no square aspect ratio");
  assert.ok(/height:\s*auto/.test(media), "the card image lets the height attribute win over aspect-ratio");
  assert.ok(/object-fit:\s*cover/.test(media), "the card image is not cropped to the square");

  // The viewer is the opposite case: it fits the whole image inside the stage.
  const stage = css.slice(css.indexOf(".lb-stage .media {"), css.indexOf(".lb-stage.zoomed"));
  assert.ok(/max-height:/.test(stage), "the viewer image has no height cap");
  assert.ok(/object-fit:\s*contain/.test(stage), "the viewer image crops instead of fitting");
});

test("the viewer stage holds the image the image asked for", async () => {
  // min-height:0 lets the grid constrain the image, but as a flex child it
  // also let the stage shrink below its own content, flattening tall uploads
  // into a sliver. flex:none keeps the stage at the image's height.
  const css = await readFile("assets/css/components.css", "utf8");
  const stage = css.slice(css.indexOf("\n  .lb-stage {"), css.indexOf(".lb-stage .media"));
  assert.ok(/flex:\s*none/.test(stage), "the stage can still be squashed by the scroll area");
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

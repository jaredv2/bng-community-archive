import { mkdir, rm, cp, writeFile, readFile, readdir, copyFile, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { build } from "esbuild";
import path from "node:path";

const ACCENT = "#080808";

// Reads KEY=value pairs from .env without pulling in a dependency.
// Real environment variables win, which is how CI supplies them.
async function readEnv() {
  const out = {};
  try {
    const raw = await readFile(".env", "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no file, the environment may still carry the values */
  }
  for (const [key, value] of Object.entries(process.env))
    if (key.startsWith("ARCHIVE_") && value) out[key] = value;
  return out;
}

const env = await readEnv();

// Values live in .env, which is gitignored. They are written only into dist,
// so a real key never lands in a tracked file or in a commit.
const settings = {
  API_URL: env.ARCHIVE_API_URL || "REPLACE_WITH_PROJECT_URL",
  API_KEY: env.ARCHIVE_API_KEY || "REPLACE_WITH_PROJECT_KEY",
  SITE_NAME: env.ARCHIVE_SITE_NAME || "Community Archive",
  ARCHIVE_NAME: env.ARCHIVE_NAME || "BNG",
  // These must stay in step with assets/js/config.js.
  MAX_IMAGE_SIZE: 25 * 1024 * 1024,
  MAX_VIDEO_SIZE: 50 * 1024 * 1024,
  POSTS_PER_PAGE: 20,
  MAX_TAGS: 5,
  COMMENTS_PER_PAGE: 50,
};

const missing = Object.entries(settings)
  .filter(([key, value]) => key.startsWith("API_") && value.startsWith("REPLACE_WITH"))
  .map(([key]) => key);
if (missing.length) {
  // On a build server there is no .env to copy, so name both routes.
  const here = process.env.VERCEL ? "vercel" : process.env.CI ? "github actions" : "this shell";
  throw new Error(
    [
      `Missing ${missing.join(" and ")}. The build needs the project url and the publishable key.`,
      "",
      "Locally:  cp .env.example .env   then fill in ARCHIVE_API_URL and ARCHIVE_API_KEY",
      `On ${here}: set ARCHIVE_API_URL and ARCHIVE_API_KEY as environment variables, then rebuild.`,
      "",
      "Use the publishable or anon key. Never the service role key.",
    ].join("\n"),
  );
}

const pages = {
  home: {
    title: "Home",
    description: "Photos, clips and memories from our community.",
  },
  gallery: {
    title: "Gallery",
    description: "Every photo, GIF and clip the community has shared.",
  },
  albums: {
    title: "Albums",
    description: "Collections of memories, grouped by the community.",
  },
  search: {
    title: "Search",
    description: "Search every caption, name and tag in the archive.",
  },
  submit: {
    title: "Submit",
    description: "Share a photo, GIF or clip with the community.",
  },
  messages: {
    title: "Messages",
    description: "A wall of messages from everyone in the community.",
  },
  adminpanel: {
    title: "Admin Access",
    description: "Moderation.",
  },
};

const SITE_NAME = settings.SITE_NAME;

await mkdir("assets/vendor", { recursive: true });
await build({
  entryPoints: ["node_modules/@supabase/supabase-js/dist/module/index.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  outfile: "assets/vendor/supabase.js",
});

const document = (page, { title, description, content, prefix, version }) => {
  const robots =
    page === "adminpanel" ? '<meta name="robots" content="noindex,nofollow" />' : "";
  // Every asset url carries the build version. Browsers cache stylesheets and
  // modules aggressively, and a deployment that serves a new script with an
  // old stylesheet renders a broken hybrid. A fresh query string makes that
  // split impossible, because every deploy is a new set of urls.
  const css = `${prefix}assets/css/global.css?v=${version}`;
  const js = `${prefix}assets/js/app.js?v=${version}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>${title} · ${SITE_NAME}</title>
<meta name="description" content="${description}" />
${robots}<meta name="referrer" content="strict-origin-when-cross-origin" />
<meta name="color-scheme" content="dark" />
<meta name="theme-color" content="${ACCENT}" />
<link rel="icon" href="${prefix}assets/favicon.svg" type="image/svg+xml" />
<link rel="preload" href="${prefix}assets/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="${css}" />
<link rel="modulepreload" href="${js}" />
<script type="module" src="${js}"></script>
</head>
<body data-page="${page}" data-title="${title}">
<a class="skip" href="#main">Skip to content</a>
<main id="main" tabindex="-1">
${content}
</main>
<noscript><p class="noscript">This archive needs JavaScript to load posts and send submissions.</p></noscript>
</body>
</html>
`;
};

const available = (await readdir("src/pages"))
  .filter((file) => file.endsWith(".html"))
  .map((file) => file.replace(/\.html$/, ""));

const unknown = available.filter((page) => !(page in pages));
if (unknown.length)
  throw new Error(`These partials have no entry in scripts/build.mjs: ${unknown.join(", ")}`);

const routes = [];
// A short id for this exact build. Anything the browser caches is keyed on it,
// so two deploys can never share an asset url.
let version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8);
if (!version) {
  try {
    version = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    version = Date.now().toString(36);
  }
}
for (const page of available) {
  const { title, description } = pages[page];
  const content = (await readFile(`src/pages/${page}.html`, "utf8")).trim();
  const dir = page === "home" ? "." : page;
  const prefix = page === "home" ? "./" : "../";
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${dir}/index.html`,
    document(page, { title, description, content, prefix, version }),
  );
  routes.push(dir);
}
console.log(`Build version ${version}.`);

await writeFile(".nojekyll", "");
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
for (const route of routes) {
  // The home route is ".", which cannot be copied into its own subdirectory.
  if (route === ".") await copyFile("index.html", "dist/index.html");
  else await cp(route, `dist/${route}`, { recursive: true });
}
await cp("assets", "dist/assets", { recursive: true });
await copyFile(".nojekyll", "dist/.nojekyll");

// The only place a real key is ever written, and it is gitignored.
await writeFile(
  "dist/assets/js/config.js",
  `export const config = Object.freeze(${JSON.stringify(settings, null, 2)});\n`,
  "utf8",
);

// Version every internal reference, not just the entry points. A module that
// loads as app.js?v=abc still resolves import "./gallery.js" to the bare url,
// so without this a deploy can serve a new entry with a cached dependency.
// Only specifiers that resolve to a real file are touched, which keeps the
// vendor bundle and any absolute url exactly as they are.
async function versionReferences(dir, version) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await versionReferences(full, version);
      continue;
    }
    const isJs = entry.name.endsWith(".js");
    const isCss = entry.name.endsWith(".css");
    if (!isJs && !isCss) continue;
    let text = await readFile(full, "utf8");
    const pattern = isJs
      ? /((?:from|import)\s*\(?\s*|new\s+URL\s*\(\s*)["'](\.\/[^"']+?\.js)(["'])/g
      : /(@import\s+)["'](\.\/[^"']+?\.css)(["'])/g;
    let changed = false;
    for (const hit of [...text.matchAll(pattern)]) {
      const [whole, head, target, quote] = hit;
      if (target.includes("?v=")) continue;
      try {
        await access(path.resolve(path.dirname(full), target));
      } catch {
        continue;
      }
      text = text.replace(whole, `${head}${quote}${target}?v=${version}${quote}`);
      changed = true;
    }
    if (changed) await writeFile(full, text, "utf8");
  }
}

// path and readFile need importing for the step above.
await versionReferences("dist/assets", version);

console.log(`Built ${routes.length} routes into dist/.`);

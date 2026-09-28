import { mkdir, rm, cp, writeFile, readFile, readdir, copyFile } from "node:fs/promises";
import { build } from "esbuild";

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
if (missing.length)
  throw new Error(
    `Missing ${missing.join(" and ")}. Copy .env.example to .env and fill it in, then build again.`,
  );


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

const document = (page, { title, description, content, prefix }) => {
  const robots =
    page === "adminpanel" ? '<meta name="robots" content="noindex,nofollow" />' : "";
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
<link rel="stylesheet" href="${prefix}assets/css/global.css" />
<link rel="modulepreload" href="${prefix}assets/js/app.js" />
<script type="module" src="${prefix}assets/js/app.js"></script>
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
for (const page of available) {
  const { title, description } = pages[page];
  const content = (await readFile(`src/pages/${page}.html`, "utf8")).trim();
  const dir = page === "home" ? "." : page;
  const prefix = page === "home" ? "./" : "../";
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${dir}/index.html`,
    document(page, { title, description, content, prefix }),
  );
  routes.push(dir);
}

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

console.log(`Built ${routes.length} routes into dist/.`);

import { mkdir, rm, cp, writeFile, readFile } from "node:fs/promises";
import { build } from "esbuild";
const pages = {
  home: {
    title: "Home",
    content: `<section class="hero"><div><h1>Community<br>Archive<span class="muted">.</span></h1><div class="actions"><a class="button primary" data-href="gallery/">View gallery <span aria-hidden="true">↗</span></a><a class="button" data-href="submit/">Submit something</a></div></div></section><section class="section"><div class="section-heading"><h2>From the archive</h2><a class="text-link" data-href="gallery/">Explore all memories ↗</a></div><div id="posts" class="grid"><div class="empty">Loading memories…</div></div></section><section class="section"><div class="section-heading"><h2>A few words from everyone</h2><a class="text-link" data-href="messages/">Leave a message ↗</a></div><div id="messages" class="message-grid"><div class="empty">Loading messages…</div></div></section>`,
  },
  gallery: {
    title: "Gallery",
    content: `<header class="page-heading"><span class="eyebrow">The shared camera roll</span><h1>The gallery.</h1><p>Our moments, big and small. Pinned memories come first.</p></header><section aria-label="Gallery posts"><div id="posts" class="grid"><div class="empty">Loading gallery…</div></div></section>`,
  },
  submit: {
    title: "Submit",
    content: `<div class="narrow"><header class="page-heading"><span class="eyebrow">Add to the collection</span><h1>Got a memory?</h1><p>Share a photo, GIF or clip. Every submission is reviewed before it joins the archive.</p></header><form id="submit-form" class="form-card stack"><label>Your name<input name="username" required maxlength="60" placeholder="What should we call you?" autocomplete="nickname"></label><label>Caption<textarea name="caption" required maxlength="1000" rows="3" placeholder="A little context for this moment…"></textarea></label><div id="dropzone" class="dropzone"><span class="upload-symbol" aria-hidden="true">↥</span><strong>Drop your memory here</strong><label class="button" for="file">Choose file<input id="file" type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm"></label><p class="hint">JPG, PNG, WebP, GIF · up to 20 MB<br>MP4, WebM · up to 50 MB</p></div><div id="preview"></div><progress id="upload-progress" max="100" value="0" hidden aria-label="Upload progress"></progress><div id="upload-label" role="status"></div><button id="submit-button" class="primary">Send for approval ↗</button><p class="hint">Only share media you have permission to share.</p></form></div>`,
  },
  messages: {
    title: "Messages",
    content: `<div class="narrow"><header class="page-heading center"><span class="eyebrow">The community wall</span><h1>Leave a Message</h1><p>A hello, an inside joke, or something to remember.</p></header><form id="message-form" class="form-card stack"><label>Name<input name="name" required maxlength="60" autocomplete="nickname" placeholder="Your name"></label><label>Message<textarea name="content" required maxlength="2000" rows="5" placeholder="Leave a few words…"></textarea></label><button class="primary">Post Message ↗</button></form><section aria-label="Public messages"><div class="section-heading"><h2>From the community</h2><span class="eyebrow">Open to everyone</span></div><div id="messages"><div class="empty">Loading messages…</div></div></section></div>`,
  },
  adminpanel: {
    title: "Admin Access",
    content: `<header class="page-heading"><span class="eyebrow">Community Archive</span><h1>Admin Access</h1></header><form id="admin-login" class="form-card stack narrow"><p id="admin-status" class="muted" role="status">Sign in to review submissions.</p><label>Email<input type="email" name="email" required autocomplete="username"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button class="primary">Unlock</button></form><section id="dashboard" hidden><div class="section-heading"><h2>Review the archive</h2><button id="logout">Logout</button></div><div class="tabs" aria-label="Submission status"><button data-status="pending" aria-pressed="true">Pending</button><button data-status="approved" aria-pressed="false">Approved</button></div><div id="admin-posts" class="grid"></div><button id="admin-more" class="load-more" hidden>Load more</button></section>`,
  },
};
await mkdir("assets/vendor", { recursive: true });
await build({
  entryPoints: ["node_modules/@supabase/supabase-js/dist/module/index.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  outfile: "assets/vendor/supabase.js",
});
for (const [page, { title, content }] of Object.entries(pages)) {
  const dir = page === "home" ? "." : page;
  const prefix = page === "home" ? "./" : "../";
  await mkdir(dir, { recursive: true });
  await writeFile(
    `${dir}/index.html`,
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Photos, clips and memories from our community.">${page === "adminpanel" ? '<meta name="robots" content="noindex,nofollow">' : ""}<meta name="referrer" content="strict-origin-when-cross-origin"><meta name="theme-color" content="#080808"><title>${title} · Community Archive</title><link rel="icon" href="${prefix}assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${prefix}assets/css/global.css"><script type="module" src="${prefix}assets/js/app.js"></script></head><body data-page="${page}" data-title="${title}"><a class="skip" href="#main">Skip to content</a><main id="main">${content}</main><noscript><p>This archive needs JavaScript to load posts and send submissions.</p></noscript></body></html>\n`,
  );
}
await writeFile(".nojekyll", "");
await rm("dist", { recursive: true, force: true });
await mkdir("dist");
for (const path of [
  "index.html",
  "gallery",
  "submit",
  "messages",
  "adminpanel",
  "assets",
  ".nojekyll",
])
  await cp(path, `dist/${path}`, { recursive: true });
console.log("Built all five static routes into dist/.");


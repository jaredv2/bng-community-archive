import { createClient } from "../vendor/supabase.js";
import { config } from "./config.js";

const missing = !config.API_URL || !config.API_KEY || config.API_URL.includes("REPLACE_WITH");

export const db = missing
  ? null
  : createClient(config.API_URL, config.API_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

export function connected() {
  if (!db)
    throw new Error("The archive is not connected yet. Please check back soon.");
  return db;
}

export function ready() {
  return Boolean(db);
}

export async function result(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// A blocked cross origin request never reaches our error handler, so the browser
// reports a bare network failure with no response body. Say something useful.
const originHint = () =>
  `The archive refused a request from ${location.origin}. Add that exact address ` +
  `to ALLOWED_ORIGINS on the function, then redeploy it.`;

export async function api(action, body = {}) {
  const { data, error } = await connected().functions.invoke("archive", {
    body: { action, ...body },
  });
  if (!error) return data;
  // An http error carries a response we can read. A blocked request does not.
  if (error.context) {
    let message = "The archive could not complete this request. Please try again.";
    try {
      message = (await error.context.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  throw new Error(originHint());
}

const MEDIA = "community-media";
const POSTERS = "community-posters";
const HOUR = 3600;

async function sign(bucket, paths) {
  if (!paths.length) return [];
  return result(connected().storage.from(bucket).createSignedUrls(paths, HOUR));
}

// Cards render the small poster, the lightbox loads the original.
export async function signPosts(posts) {
  if (!posts.length) return posts;
  const wantPoster = posts.some((p) => p.poster_path);
  const [media, posters] = await Promise.all([
    sign(MEDIA, posts.map((p) => p.storage_path)),
    wantPoster ? sign(POSTERS, posts.map((p) => p.poster_path).filter(Boolean)) : Promise.resolve([]),
  ]);
  let posterAt = 0;
  return posts.map((post, i) => {
    const url = media[i]?.signedUrl;
    if (!url)
      throw new Error("Could not load this media. Please refresh and try again.");
    const out = { ...post, url };
    if (post.poster_path) out.poster = posters[posterAt++]?.signedUrl || null;
    return out;
  });
}

export function previewUrl(post) {
  return post.poster || post.url;
}

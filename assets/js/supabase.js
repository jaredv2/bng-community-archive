import { createClient } from "../vendor/supabase.js";
import { config } from "./config.js";
export const db =
  config.SUPABASE_URL && config.SUPABASE_ANON_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    : null;
export function connected() {
  if (!db)
    throw new Error(
      "The archive is not connected yet. Please check back soon.",
    );
  return db;
}
export async function result(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
export async function api(action, body = {}) {
  const { data, error } = await connected().functions.invoke("archive", {
    body: { action, ...body },
  });
  if (error) {
    let message =
      "The archive could not complete this request. Please try again.";
    try {
      message = (await error.context.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return data;
}
export function mediaUrl(post) {
  return post.url;
}
export async function signPosts(posts) {
  if (!posts.length) return posts;
  const signed = await result(
    connected()
      .storage.from("community-media")
      .createSignedUrls(
        posts.map((p) => p.storage_path),
        3600,
      ),
  );
  return posts.map((p, i) => {
    if (!signed[i]?.signedUrl) throw new Error("Could not load this media. Please refresh and try again.");
    return { ...p, url: signed[i].signedUrl };
  });
}

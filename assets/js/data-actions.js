import { connected, result, signPosts, api } from "./data.js";
import { config } from "./config.js";
import { text, validateTags } from "./validation.js";

const POST_FIELDS =
  "id,username,caption,storage_path,poster_path,media_type,width,height,likes,pinned,created_at,tags(name),comments(count)";

// Fetches one approved memory by id, for a shared link that points at something
// outside the page the visitor is looking at. Returns null when it is gone or
// not approved, so a stale link opens nothing rather than a broken viewer.
export async function loadPost(id) {
  if (!id) return null;
  const rows = await result(
    connected()
      .from("posts")
      .select(POST_FIELDS)
      .eq("id", id)
      .eq("status", "approved")
      .limit(1),
  );
  if (!rows.length) return null;
  return (await signPosts(rows))[0];
}

export async function bumpPostLikes(id) {
  return result(connected().rpc("increment_post_likes", { post_id: id }));
}

export async function loadComments(postId, offset = 0, limit = config.COMMENTS_PER_PAGE) {
  return result(
    connected()
      .from("comments")
      .select("id,name,content,created_at")
      .eq("post_id", postId)
      .order("created_at")
      .order("id")
      .range(offset, offset + limit - 1),
  );
}

export async function addComment(postId, name, content) {
  await result(
    connected()
      .from("comments")
      .insert({
        post_id: postId,
        name: text(name, 60, "Name"),
        content: text(content, 2000, "Comment"),
      }),
  );
}

export async function reserve({
  username,
  caption,
  tags,
  ext,
  mime,
  size,
  hasPoster = false,
  width = null,
  height = null,
}) {
  return api("reserve", {
    username: text(username, 60, "Name"),
    caption: text(caption, 1000, "Caption"),
    tags: validateTags(tags),
    ext,
    mime,
    size,
    has_poster: Boolean(hasPoster),
    width: Number.isSafeInteger(width) && width > 0 ? width : null,
    height: Number.isSafeInteger(height) && height > 0 ? height : null,
  });
}

export const finalize = (id, token) => api("finalize", { id, token });

export const createAlbum = (payload) =>
  api("create-album", {
    title: text(payload.title, 80, "Title"),
    description: text(payload.description, 400, "Description"),
    creator_name: text(payload.creator_name, 60, "Name"),
  });

export const addToAlbum = (albumId, postId) =>
  api("album-add", { album_id: albumId, post_id: postId });

export const removeFromAlbum = (albumId, postId) =>
  api("album-remove", { album_id: albumId, post_id: postId });

export const report = (payload) =>
  api("report", {
    target_type: payload.target_type,
    target_id: payload.target_id,
    reason: text(payload.reason, 300, "Reason"),
  });

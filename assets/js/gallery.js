import { connected, result, mediaUrl, signPosts } from "./supabase.js";
import { $, el, empty, busy, dialog, date, toast } from "./ui.js";
import { config } from "./config.js";
import { text } from "./validation.js";
export function media(post, url = mediaUrl(post), full = false) {
  const video = post.media_type === "video";
  const n = el(video ? "video" : "img", "media");
  n.src = url;
  if (video) {
    n.preload = "metadata";
    n.controls = full;
    n.playsInline = true;
    if (!full) {
      n.setAttribute("aria-label", "Video preview");
      n.tabIndex = -1;
    }
  } else {
    n.alt = post.caption;
    n.loading = "lazy";
    n.decoding = "async";
  }
  return n;
}
export function card(post) {
  const article = el("article", "post-card");
  const open = el("button", "media-button");
  open.setAttribute(
    "aria-label",
    `Open post by ${post.username}: ${post.caption}`,
  );
  open.append(media(post));
  const type = el(
    "span",
    "media-tag",
    post.pinned ? "↗ PINNED" : post.media_type.toUpperCase(),
  );
  open.append(type);
  open.onclick = () => openPost(post);
  const body = el("div", "post-body");
  const meta = el("div", "post-meta");
  meta.append(
    el("strong", "", post.username),
    el("span", "muted", date(post.created_at)),
  );
  const caption = el("p", "caption", post.caption);
  const stats = el(
    "button",
    "post-stats",
    `♡ ${post.likes.toLocaleString()}  ·  ${post.comments?.[0]?.count || 0} comments`,
  );
  stats.onclick = () => openPost(post);
  body.append(meta, caption, stats);
  article.append(open, body);
  return article;
}
export async function loadGallery(
  root,
  limit = config.POSTS_PER_PAGE,
  { home = false, status = "approved" } = {},
) {
  let page = 0,
    loading = false;
  const more = el("button", "load-more", "Load more");
  const load = async () => {
    if (loading) return;
    loading = true;
    more.disabled = true;
    more.textContent = "Loading…";
    try {
      const posts = await result(
        connected()
          .from("posts")
          .select(
            "id,username,caption,storage_path,media_type,likes,pinned,created_at,comments(count)",
          )
          .eq("status", status)
          .order("pinned", { ascending: false })
          .order("approved_at", { ascending: false })
          .order("id")
          .range(page * limit, (page + 1) * limit - 1),
      );
      if (!page) root.replaceChildren();
      (await signPosts(posts)).forEach((p) => root.append(card(p)));
      if (!posts.length && !page)
        empty(
          root,
          "No posts have been added yet. Your memories can start the archive.",
        );
      page++;
      more.hidden = home || posts.length < limit;
    } catch (e) {
      if (!page) empty(root, e.message);
      more.hidden = home;
    } finally {
      loading = false;
      more.disabled = false;
      more.textContent = "Load more";
    }
  };
  if (!home) root.after(more);
  more.onclick = load;
  await load();
}
export async function openPost(post) {
  try {
    await displayPost(post);
  } catch (e) {
    toast(e.message, true);
  }
}
async function displayPost(post) {
  post = (await signPosts([post]))[0];
  const d = dialog(post.username);
  const content = el("div", "post-detail");
  content.append(
    media(post, mediaUrl(post), true),
    el("p", "detail-caption", post.caption),
  );
  const like = el("button", "like", `♡ ${post.likes} likes`);
  like.onclick = async () => {
    like.disabled = true;
    try {
      post.likes = await result(
        connected().rpc("increment_post_likes", { post_id: post.id }),
      );
      like.textContent = `♥ ${post.likes} likes`;
    } catch (e) {
      toast(e.message, true);
    } finally {
      like.disabled = false;
    }
  };
  content.append(like, el("h3", "", "Conversation"));
  const list = el("div", "comments");
  content.append(list);
  const more = el("button", "small", "Older conversation loaded · Show more");
  more.hidden = true;
  content.append(more);
  let offset = 0;
  const fetchComments = async (reset = false) => {
    if (reset) {
      offset = 0;
      list.replaceChildren();
    }
    const rows = await result(
      connected()
        .from("comments")
        .select("id,name,content,created_at")
        .eq("post_id", post.id)
        .order("created_at")
        .order("id")
        .range(offset, offset + 49),
    );
    if (!offset && !rows.length) empty(list, "No comments yet. Be the first.");
    rows.forEach((row) => list.append(commentCard(row)));
    offset += rows.length;
    more.hidden = rows.length < 50;
  };
  more.onclick = () => busy(more, "Loading…", () => fetchComments());
  const form = el("form", "stack");
  form.innerHTML =
    '<label>Name<input name="name" required maxlength="60" autocomplete="nickname"></label><label>Comment<textarea name="content" required maxlength="2000" rows="3" placeholder="Add to the memory…"></textarea></label><button class="primary">Post comment</button>';
  form.onsubmit = (e) => {
    e.preventDefault();
    busy($("button", form), "Posting comment…", async () => {
      const data = new FormData(form);
      await result(
        connected()
          .from("comments")
          .insert({
            post_id: post.id,
            name: text(data.get("name"), 60, "Name"),
            content: text(data.get("content"), 2000, "Comment"),
          }),
      );
      form.reset();
      await fetchComments(true);
      toast("Comment posted.");
    });
  };
  content.append(form);
  d.append(content);
  d.showModal();
  try {
    await fetchComments();
  } catch (e) {
    empty(list, e.message);
  }
}
export function commentCard(row) {
  const n = el("article", "message");
  const meta = el("div", "post-meta");
  meta.append(
    el("strong", "", row.name),
    el("time", "muted", date(row.created_at)),
  );
  n.append(meta, el("p", "", row.content));
  return n;
}

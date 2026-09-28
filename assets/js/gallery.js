import { connected, result, signPosts, ready } from "./data.js";
import { $, $$, el, empty, showEmpty, date, url } from "./ui.js";
import { config } from "./config.js";
import { mediaNode, openLightbox, readDeepLink, closeLightbox } from "./lightbox.js";
import { observe, watchMedia, bindGif } from "./motion.js";
import { play } from "./sound.js";

const FIELDS =
  "id,username,caption,storage_path,poster_path,media_type,width,height,likes,pinned,created_at,tags(name),comments(count)";

function tagLinks(post) {
  return (post.tags || []).map((tag) => {
    const link = el("a", "tag-link", `#${tag.name}`);
    link.href = url(`search/?tag=${encodeURIComponent(tag.name)}`);
    link.dataset.sound = "tap";
    return link;
  });
}

export function card(post, list) {
  const article = el("article", "post-card");
  article.dataset.postId = post.id;

  const open = el("button", "media-button");
  open.dataset.sound = "open";
  open.setAttribute(
    "aria-label",
    `Open memory by ${post.username}: ${post.caption || post.media_type}`,
  );
  open.append(mediaNode(post, { full: false, poster: true }));
  open.append(
    el("span", "media-tag", post.pinned ? "PINNED" : post.media_type.toUpperCase()),
  );
  open.dataset.postId = post.id;
  open.onclick = () => {
    play("open");
    openLightbox(post, list);
  };

  const body = el("div", "post-body");
  const meta = el("div", "post-meta");
  meta.append(el("strong", "", post.username), el("span", "muted", date(post.created_at)));
  body.append(meta);
  if (post.caption) body.append(el("p", "caption", post.caption));
  if (post.tags?.length) {
    const tagRow = el("div", "card-tags");
    tagRow.append(...tagLinks(post));
    body.append(tagRow);
  }

  const comments = post.comments?.[0]?.count || 0;
  const stats = el(
    "button",
    `post-stats ${post.liked ? "liked" : ""}`,
    `♡ ${Number(post.likes || 0).toLocaleString()} · ${comments} comment${comments === 1 ? "" : "s"}`,
  );
  stats.dataset.sound = "open";
  stats.onclick = () => openLightbox(post, list);

  body.append(stats);
  article.append(open, body);
  return article;
}

export async function loadGallery(root, options = {}) {
  const { limit = config.POSTS_PER_PAGE, home = false, filter = "all", tag = null } = options;
  if (!ready()) {
    showEmpty(root, {
      icon: "⚡",
      title: "Not connected yet",
      body: "The archive cannot reach the store right now. Give it a moment and refresh.",
    });
    return;
  }

  const loaded = [];
  let page = 0;
  let busyLoading = false;
  let filterValue = filter;
  let tagValue = tag;

  const count = $("#gallery-count");
  const sentinel = $("#sentinel");
  const more = $("#gallery-more");
  const filterButtons = $$('[data-filter]');

  function applyFilterButtons() {
    filterButtons.forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.filter === filterValue)),
    );
  }
  filterButtons.forEach((button) => {
    button.onclick = () => {
      filterValue = button.dataset.filter;
      applyFilterButtons();
      play("tap");
      reset();
    };
  });
  applyFilterButtons();

  function reset() {
    page = 0;
    loaded.length = 0;
    if (sentinel) observer?.disconnect();
  }

  // Called whenever a render produced nothing, so a grid is never left blank.
  function renderEmpty(onShowAll) {
    root.classList.remove("stagger", "in");
    if (tagValue) {
      return showEmpty(root, {
        icon: "#",
        title: `Nothing tagged #${tagValue}`,
        body: "No memory carries that tag yet. Browse everything, or add the first one.",
        action: "Browse all memories",
        href: url("gallery/"),
      });
    }
    if (filterValue !== "all") {
      const label = { image: "photos", gif: "GIFs", video: "clips" }[filterValue] || filterValue;
      return showEmpty(root, {
        icon: "▦",
        title: `No ${label} yet`,
        body: `Nothing in the archive is a ${label === "GIFs" ? "GIF" : label.replace(/s$/, "")} so far. Try another filter.`,
        action: "Show everything",
      });
    }
    showEmpty(root, {
      icon: "▦",
      title: "The archive is empty",
      body: home
        ? "Nothing has been shared yet. The first memory starts the whole collection."
        : "Nothing has been shared yet. Yours can be the first one on the shelf.",
      action: home ? null : "Share something",
      href: url("submit/"),
    });
  }

  function render(posts, onShowAll) {
    const wanted =
      filterValue === "all"
        ? posts
        : posts.filter((post) =>
            post.media_type === filterValue ||
            (filterValue === "image" && post.media_type === "image"),
          );
    const batch = [];
    for (const post of wanted) {
      if (tagValue && !(post.tags || []).some((tag) => tag.name === tagValue)) continue;
      loaded.push(post);
      batch.push(card(post, loaded));
    }
    root.append(...batch);
    if (batch.length) {
      root.classList.add("stagger");
      batch.forEach((node, i) => {
        node.style.setProperty("--i", String(i));
      });
      requestAnimationFrame(() => root.classList.add("in"));
    } else if (!loaded.length) {
      renderEmpty(onShowAll);
    }
    if (count)
      count.textContent = loaded.length
        ? `${loaded.length} memor${loaded.length === 1 ? "y" : "ies"}`
        : "";
    bindGif(root);
    watchMedia(root);
    observe(root);
  }

  async function load() {
    if (busyLoading) return;
    busyLoading = true;
    if (more) {
      more.disabled = true;
      more.textContent = "Loading…";
    }
    try {
      let query = connected()
        .from("posts")
        .select(FIELDS)
        .eq("status", "approved")
        .order("pinned", { ascending: false })
        .order("approved_at", { ascending: false })
        .order("id")
        .range(page * limit, (page + 1) * limit - 1);
      if (tagValue) query = query.eq("tags.name", tagValue);
      const posts = await signPosts(await result(query));
      if (!page) {
        root.replaceChildren();
        root.classList.remove("in");
      }
      render(posts, () => {
        filterValue = "all";
        applyFilterButtons();
        reset();
        load();
      });
      page++;
      const done = posts.length < limit;
      if (more) more.hidden = home || done;
      if (sentinel) done ? observer?.unobserve(sentinel) : observeSentinel();
    } catch (error) {
      if (!page) {
        showEmpty(root, {
          icon: "!",
          title: "Could not load the gallery",
          body: error.message,
        });
      }
      if (more) more.hidden = true;
    } finally {
      busyLoading = false;
      if (more) {
        more.disabled = false;
        more.textContent = "Load more";
      }
    }
  }

  let observer = null;
  function observeSentinel() {
    if (!sentinel || !("IntersectionObserver" in window)) return;
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) load();
        },
        { rootMargin: "400px" },
      );
    }
    observer.observe(sentinel);
  }

  if (more) more.onclick = () => load();
  if (!home) await load();
  else {
    // Home shows a fixed slice with no pagination controls, but it still needs
    // the empty placeholder when there is nothing to show.
    try {
      const posts = await signPosts(
        await result(
          connected()
            .from("posts")
            .select(FIELDS)
            .eq("status", "approved")
            .order("pinned", { ascending: false })
            .order("approved_at", { ascending: false })
            .limit(3),
        ),
      );
      root.replaceChildren();
      render(posts);
    } catch (error) {
      showEmpty(root, { icon: "!", title: "Could not load the archive", body: error.message });
    }
  }

  if (home) return loaded;

  // Restore a shared link straight into the viewer.
  const target = readDeepLink(loaded);
  if (target) openLightbox(target, loaded);
  window.addEventListener("popstate", () => {
    if (location.search.includes("post=")) return;
    closeLightbox();
  });
  return loaded;
}

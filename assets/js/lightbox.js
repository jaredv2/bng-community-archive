import { $, el, url, date, relative, toast, fieldError } from "./ui.js";
import { previewUrl } from "./data.js";
import { play } from "./sound.js";
import { reducedMotion } from "./motion.js";
import { config } from "./config.js";

const ZOOMS = [1, 1.5, 2.5, 4];
let current = null;

export function mediaNode(post, { full = false, poster = true } = {}) {
  const node = post.media_type === "video" ? el("video", "media") : el("img", "media");
  const source = poster ? previewUrl(post) : post.url;
  if (node.tagName === "VIDEO") {
    node.src = post.url;
    node.preload = full ? "auto" : "metadata";
    node.playsInline = true;
    node.muted = !full;
    node.controls = full;
    node.setAttribute("playsinline", "");
    if (!full) {
      node.setAttribute("aria-hidden", "true");
      node.tabIndex = -1;
    }
  } else {
    node.src = source;
    node.alt = post.caption || `Shared by ${post.username}`;
    node.loading = full ? "eager" : "lazy";
    node.decoding = "async";
    // A card shows the poster, so hovering has to swap in the real animation.
    // Saving node.src here would just save the poster and swap it for itself.
    if (post.media_type === "gif" && !full && post.url) {
      node.dataset.gif = "1";
      node.dataset.gifSrc = post.url;
    }
    if (post.width && post.height) {
      node.width = post.width;
      node.height = post.height;
    }
  }
  return node;
}

// Keeps ?post=<id> in the address bar so any view can be linked.
function syncUrl(post) {
  if (!current) return;
  const target = url("gallery/");
  const next = post ? `${target}?post=${encodeURIComponent(post.id)}` : target;
  history.replaceState({ post: post?.id || null }, "", next);
}

export function closeLightbox() {
  const open = current;
  if (!open) return;
  current = null;
  play("close");
  open.modal.node.classList.add("closing");
  open.stage.querySelectorAll("video").forEach((video) => video.pause());
  open.modal.close();
  syncUrl(null);
  if (open.origin) open.origin.focus?.();
}

// Restores focus to the card that opened the lightbox.
let lastOrigin = null;
export function openLightbox(post, list, options = {}) {
  if (current) closeLightbox();
  lastOrigin = document.activeElement;
  const items = list || [post];
  let index = Math.max(0, items.findIndex((p) => p.id === post.id));
  const origin = lastOrigin;
  origin?.setAttribute?.("data-lightbox", "open");

  const modal = makeModal();
  const view = {
    posts: items,
    modal,
    origin,
    index: () => index,
    go: (next) => show(next),
  };
  current = view;
  const close = () => {
    origin?.removeAttribute?.("data-lightbox");
    closeLightbox();
  };
  modal.node.addEventListener("close", () => {
    if (current === view) {
      current = null;
      origin?.removeAttribute?.("data-lightbox");
      syncUrl(null);
    }
  });
  modal.wireClose(close);
  // Clicking the backdrop, or any empty part of the frame, closes the viewer.
  // A press that starts inside the content and drags out must not dismiss it.
  modal.onDismiss(close);

  function show(next) {
    index = (next + items.length) % items.length;
    const item = items[index];
    modal.setTitle(`${item.username} · ${relative(item.created_at)}`);
    modal.stage.replaceChildren(mediaNode(item, { full: true, poster: false }));
    modal.caption.textContent = item.caption || "";
    modal.counter.textContent = items.length > 1 ? `${index + 1} of ${items.length}` : "";
    modal.prev.hidden = modal.next.hidden = items.length < 2;
    modal.like.textContent = `♡ ${Number(item.likes || 0).toLocaleString()}`;
    modal.like.classList.toggle("liked", Boolean(item.liked));
    modal.albums.replaceChildren(
      ...(item.albums || []).map((album) => {
        const link = el("a", "tag-link", `#${album.title}`);
        link.href = url(`albums/?a=${encodeURIComponent(album.slug || album.title)}`);
        link.dataset.sound = "nav";
        return link;
      }),
    );
    modal.meta.textContent = `${date(item.created_at)} · ${item.media_type}`;
    modal.editor.hidden = item.media_type === "video";
    modal.setPost(item);
    // A new memory starts from the top, not wherever the last one was scrolled.
    modal.scrollTo?.();
    reset();
    renderFilmstrip();
    syncUrl(item);
    if (item.media_type === "video") modal.stage.querySelector("video")?.play().catch(() => {});
  }

  function renderFilmstrip() {
    if (items.length < 2) {
      modal.filmstrip.hidden = true;
      return;
    }
    modal.filmstrip.hidden = false;
    modal.filmstrip.replaceChildren(
      ...items.map((item, i) => {
        const button = el("button", "", item.media_type === "video" ? "▶" : "");
        button.setAttribute(
          "aria-label",
          `Go to memory ${i + 1} of ${items.length} by ${item.username}`,
        );
        if (i === index) button.setAttribute("aria-current", "true");
        const thumb = mediaNode(item, { full: false, poster: true });
        button.append(thumb);
        button.onclick = () => {
          play("tap");
          show(i);
        };
        button.addEventListener("pointerenter", () => {
          if (i !== index) prefetch(item);
        });
        return button;
      }),
    );
    const active = modal.filmstrip.children[index];
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  const seen = new Set();
  function prefetch(item) {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    const image = new Image();
    image.src = item.url;
  }

  // Preload the neighbours so arrow navigation feels instant.
  for (const offset of [1, -1]) {
    const item = items[(index + offset + items.length) % items.length];
    if (item) prefetch(item);
  }

  // Keyboard: arrows, escape, plus and minus for zoom, r to rotate.
  function onKey(event) {
    if (event.key === "Escape") return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      show(index + 1);
      play("nav");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(index - 1);
      play("nav");
    } else if (event.key === "+" || event.key === "=") {
      zoomBy(1);
    } else if (event.key === "-") {
      zoomBy(-1);
    } else if (event.key.toLowerCase() === "r") {
      rotate();
    } else if (event.key.toLowerCase() === "m") {
      toggleMute();
    }
  }
  document.addEventListener("keydown", onKey);
  modal.node.addEventListener("close", () => document.removeEventListener("keydown", onKey), { once: true });

  // Swipe between memories on touch devices.
  let startX = 0;
  let startY = 0;
  let tracking = false;
  modal.stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
  });
  modal.stage.addEventListener("pointerup", (event) => {
    if (!tracking) return;
    tracking = false;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) show(index + (dx < 0 ? 1 : -1));
  });

  // Zoom, pan and rotate for still images.
  let zoom = 1;
  let rotation = 0;
  let panX = 0;
  let panY = 0;
  function applyTransform() {
    const media = modal.stage.querySelector(".media");
    if (!media) return;
    media.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom}) rotate(${rotation}deg)`;
    modal.stage.classList.toggle("zoomed", zoom > 1);
  }
  function zoomBy(step) {
    if (modal.editor.hidden) return;
    zoom = Math.min(ZOOMS.at(-1), Math.max(1, ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(zoom) + step))] || 1));
    if (zoom === 1) {
      panX = 0;
      panY = 0;
      rotation = 0;
    }
    applyTransform();
    play("zoom");
  }
  function rotate() {
    if (modal.editor.hidden) return;
    rotation = (rotation + 90) % 360;
    applyTransform();
    play("zoom");
  }
  function reset() {
    zoom = 1;
    rotation = 0;
    panX = 0;
    panY = 0;
    applyTransform();
  }
  function toggleMute() {
    const video = modal.stage.querySelector("video");
    if (!video) return;
    video.muted = !video.muted;
    play("tap");
  }

  // Drag to pan while zoomed.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  modal.stage.addEventListener("pointerdown", (event) => {
    if (zoom <= 1) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    modal.stage.setPointerCapture(event.pointerId);
  });
  modal.stage.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    panX += event.clientX - lastX;
    panY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    applyTransform();
  });
  const endDrag = () => {
    dragging = false;
  };
  modal.stage.addEventListener("pointerup", endDrag);
  modal.stage.addEventListener("pointercancel", endDrag);
  modal.stage.addEventListener("wheel", (event) => {
    if (modal.editor.hidden) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  modal.stage.addEventListener("dblclick", () => zoomBy(zoom > 1 ? -ZOOMS.length : 1));

  const bind = (node, action) => {
    node.dataset.sound = "tap";
    node.onclick = () => {
      action();
    };
  };
  bind(modal.zoomIn, () => zoomBy(1));
  bind(modal.zoomOut, () => zoomBy(-1));
  bind(modal.rotate, rotate);
  bind(modal.reset, reset);
  bind(modal.mute, toggleMute);
  bind(modal.prev, () => show(index - 1));
  bind(modal.next, () => show(index + 1));

  bind(modal.share, async () => {
    const item = items[index];
    const link = url(`gallery/?post=${item.id}`);
    try {
      if (navigator.share) {
        await navigator.share({ title: `${config.SITE_NAME}`, url: link });
        play("success");
      } else {
        await navigator.clipboard.writeText(link);
        toast("Link copied.");
        play("success");
      }
    } catch {}
  });

  modal.like.onclick = async () => {
    const item = items[index];
    modal.like.disabled = true;
    try {
      const { bumpPostLikes } = await import("./data-actions.js");
      const count = await bumpPostLikes(item.id);
      item.likes = count;
      item.liked = true;
      modal.like.textContent = `♥ ${Number(count).toLocaleString()}`;
      modal.like.classList.add("liked", "pinged");
      setTimeout(() => modal.like.classList.remove("pinged"), 450);
      play("like");
      const card = origin?.dataset?.postId
        ? document.querySelector(`.post-card[data-post-id="${origin.dataset.postId}"] .post-stats`)
        : null;
      if (card) card.textContent = `♥ ${Number(count).toLocaleString()}`;
    } catch (error) {
      toast(error.message, true);
    } finally {
      modal.like.disabled = false;
    }
  };

  modal.node.addEventListener("close", () => document.removeEventListener("keydown", onKey));
  show(index);
  modal.open();
  return view;
}

function makeModal() {
  const node = el("dialog", "modal lightbox");
  node.setAttribute("aria-label", "Memory viewer");

  // Pinned head, so the way out is always reachable.
  const head = el("div", "lb-head");
  const headText = el("div", "lb-head-text");
  const title = el("strong", "");
  const meta = el("span", "");
  headText.append(title, meta);
  const close = el("button", "icon-button lb-close", "×");
  close.setAttribute("aria-label", "Close viewer");
  head.append(headText, close);

  const stage = el("div", "lb-stage");
  const prev = el("button", "icon-button lb-arrow prev", "‹");
  prev.setAttribute("aria-label", "Previous memory");
  const next = el("button", "icon-button lb-arrow next", "›");
  next.setAttribute("aria-label", "Next memory");
  const counter = el("span", "lb-badge");

  const caption = el("div", "lb-caption");
  const albums = el("div", "card-tags");
  const filmstrip = el("div", "filmstrip");
  filmstrip.setAttribute("aria-label", "All memories");

  const conversation = el("div", "comments-section");
  const conversationHeading = el("h3", "", "Conversation");
  const list = el("div", "comments");
  const showMore = el("button", "subtle", "Show earlier comments");
  showMore.hidden = true;
  const form = el("form", "stack comment-form");
  form.noValidate = true;
  const nameInput = el("input");
  nameInput.required = true;
  nameInput.maxLength = 60;
  nameInput.autocomplete = "nickname";
  nameInput.placeholder = "Your name";
  const contentInput = el("textarea");
  contentInput.required = true;
  contentInput.maxLength = 2000;
  contentInput.rows = 2;
  contentInput.placeholder = "Add to this memory…";
  const nameLabel = el("label", "", "Name");
  nameLabel.append(nameInput);
  const contentLabel = el("label", "", "Comment");
  contentLabel.append(contentInput);
  const send = el("button", "primary", "Post comment");
  send.type = "submit";
  send.dataset.sound = "tap";
  form.append(nameLabel, contentLabel, send);
  conversation.append(conversationHeading, list, showMore, form);

  // Everything that scrolls sits between two pinned bars.
  const scroll = el("div", "lb-scroll");
  scroll.append(filmstrip, stage, caption, albums, conversation);

  const editor = el("div", "lb-group");
  const zoomIn = el("button", "subtle", "+");
  zoomIn.setAttribute("aria-label", "Zoom in");
  const zoomOut = el("button", "subtle", "−");
  zoomOut.setAttribute("aria-label", "Zoom out");
  const rotate = el("button", "subtle", "↻");
  rotate.setAttribute("aria-label", "Rotate");
  const reset = el("button", "subtle", "⤢");
  reset.setAttribute("aria-label", "Reset view");
  const mute = el("button", "subtle", "♪");
  mute.setAttribute("aria-label", "Toggle sound");
  editor.append(zoomIn, zoomOut, rotate, reset, mute);

  const like = el("button", "like", "♡ 0");
  const share = el("button", "subtle", "⤴");
  share.setAttribute("aria-label", "Share this memory");

  const foot = el("div", "lb-foot");
  const footActions = el("div", "lb-group");
  footActions.append(like, share);
  foot.append(footActions, editor);

  node.append(head, scroll, foot);
  stage.append(prev, next, counter);
  document.body.append(node);

  let offset = 0;
  let currentPost = null;

  async function loadComments(reset = false) {
    if (!currentPost) return;
    if (reset) {
      offset = 0;
      list.replaceChildren();
    }
    const { loadComments: fetchComments, addComment } = await import("./data-actions.js");
    const rows = await fetchComments(currentPost.id, offset);
    if (!rows.length && !offset) {
      list.append(el("p", "hint", "No comments yet. Be the first."));
    }
    for (const row of rows) {
      const article = el("article", "message");
      const meta = el("div", "comment-meta");
      meta.append(el("strong", "", row.name), el("span", "muted", new Date(row.created_at).toLocaleDateString()));
      article.append(meta, el("p", "", row.content));
      list.append(article);
    }
    offset += rows.length;
    showMore.hidden = rows.length < 50;
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    const { addComment } = await import("./data-actions.js");
    await send.disabled
      ? null
      : run();
    async function run() {
      send.disabled = true;
      try {
        await addComment(currentPost.id, nameInput.value, contentInput.value);
        form.reset();
        fieldError(nameInput, null);
        fieldError(contentInput, null);
        play("success");
        await loadComments(true);
        toast("Comment posted.");
      } catch (error) {
        if (error.message?.startsWith("Name must")) fieldError(nameInput, error.message);
        if (error.message?.startsWith("Comment must")) fieldError(contentInput, error.message);
        toast(error.message, true);
      } finally {
        send.disabled = false;
      }
    }
  };
  showMore.onclick = async () => {
    showMore.disabled = true;
    try {
      await loadComments();
    } finally {
      showMore.disabled = false;
    }
  };

  let titleText = "";
  return {
    node,
    stage,
    caption,
    filmstrip,
    counter,
    prev,
    next,
    like,
    share,
    editor,
    mute,
    zoomIn,
    zoomOut,
    rotate,
    reset,
    get meta() {
      return meta;
    },
    get albums() {
      return albums;
    },
    setPost(post) {
      currentPost = post;
      offset = 0;
      list.replaceChildren();
      loadComments(true).catch(() => {});
    },
    setTitle(next) {
      titleText = next;
      title.textContent = next;
    },
    close() {
      node.close();
    },
    // The way out is in the pinned head, so it is always reachable.
    wireClose(handler) {
      close.onclick = handler;
    },
    onDismiss(handler) {
      let start = null;
      node.addEventListener("pointerdown", (event) => {
        start = { x: event.clientX, y: event.clientY };
      });
      node.addEventListener("pointerup", (event) => {
        if (!start) return;
        // A drag that began on the media is a zoom or a swipe, not a
        // dismissal, so only a short press on the bare frame closes it.
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        start = null;
        if (moved > 6) return;
        if (event.target === node || event.target.classList.contains("lb-scroll")) handler();
      });
    },
    scrollTo() {
      scroll.scrollTop = 0;
    },
    open() {
      play("open");
      scroll.scrollTop = 0;
      node.showModal();
      close.focus();
    },
  };
}

// Lets a deep link reopen the viewer on load.
export function readDeepLink(posts) {
  const id = new URLSearchParams(location.search).get("post");
  if (!id) return null;
  return posts.find((post) => post.id === id) || null;
}

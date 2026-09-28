import { connected, result, signPosts, ready } from "./data.js";
import { $, $$, el, empty, emptyState, showEmpty, url, dialog, toast, attempt, date, relative } from "./ui.js";
import { card } from "./gallery.js";
import { createAlbum, addToAlbum, report } from "./data-actions.js";
import { play } from "./sound.js";
import { observe, bindGif, watchMedia } from "./motion.js";
import { config } from "./config.js";

const ALBUM_FIELDS = "id,slug,title,description,creator_name,created_at,album_items(count)";
const DETAIL_FIELDS =
  "id,slug,title,description,creator_name,created_at,posts(id,username,caption,storage_path,poster_path,media_type,width,height,likes,pinned,created_at,tags(name),comments(count))";

function coverCovers(album) {
  const cover = el("div", "album-cover");
  const items = album.album_items?.[0]?.count || 0;
  for (let slot = 0; slot < 4; slot++) {
    const cell = el("div", "slot");
    if (slot >= items) cell.classList.add("empty-slot");
    cover.append(cell);
  }
  return cover;
}

function albumCard(album) {
  const cardNode = el("button", "album-card");
  cardNode.dataset.sound = "open";
  const count = album.album_items?.[0]?.count || 0;
  cardNode.setAttribute(
    "aria-label",
    `Open album ${album.title} by ${album.creator_name}, ${count} memories`,
  );
  cardNode.append(coverCovers(album));
  const body = el("div", "album-body");
  body.append(
    el("h3", "", album.title),
    el("p", "", album.description),
    el("span", "muted", `${count} memor${count === 1 ? "y" : "ies"} · ${album.creator_name} · ${relative(album.created_at)}`),
  );
  cardNode.append(body);
  cardNode.onclick = () => {
    const next = url(`albums/?a=${encodeURIComponent(album.slug)}`);
    play("nav");
    if (document.startViewTransition) document.startViewTransition(() => (location.href = next));
    else location.href = next;
  };
  return cardNode;
}

export async function albums() {
  if (!ready()) return;
  const root = $("#albums");
  const requested = new URLSearchParams(location.search).get("a");
  if (requested) return detail(requested);

  let sort = "recent";
  const list = await result(
    connected()
      .from("albums")
      .select(ALBUM_FIELDS)
      .order("created_at", { ascending: false })
      .limit(200),
  );

  function paint(rows) {
    const sorted = [...rows];
    if (sort === "size")
      sorted.sort(
        (a, b) => (b.album_items?.[0]?.count || 0) - (a.album_items?.[0]?.count || 0),
      );
    if (sort === "name") sorted.sort((a, b) => a.title.localeCompare(b.title));
    root.classList.remove("in");
    if (!sorted.length) {
      const node = emptyState({
        icon: "⊞",
        title: "No albums yet",
        body: "Albums group the archive by mood, event or whatever thread you are pulling on. Make the first one.",
        action: "New album",
      });
      // A real button here, since it opens a dialog rather than navigating.
      const button = node.querySelector("a");
      const trigger = el("button", "primary", "New album");
      trigger.type = "button";
      trigger.dataset.sound = "tap";
      trigger.onclick = () => openCreate((album) => paint([album, ...list]));
      button.replaceWith(trigger);
      root.replaceChildren(node);
      return;
    }
    const nodes = sorted.map(albumCard);
    root.classList.add("stagger");
    nodes.forEach((node, i) => node.style.setProperty("--i", String(i % 9)));
    root.replaceChildren(...nodes);
    requestAnimationFrame(() => root.classList.add("in"));
    observe(root);
  }
  paint(list);

  $$("[data-sort]").forEach((button) => {
    button.onclick = () => {
      sort = button.dataset.sort;
      $$("[data-sort]").forEach((other) =>
        other.setAttribute("aria-pressed", String(other === button)),
      );
      play("tap");
      paint(list);
    };
  });

  const create = $("#new-album");
  if (create) create.onclick = () => openCreate((album) => paint([album, ...list]));
}

function openCreate(onDone) {
  const modal = dialog("New album");
  const form = el("form", "stack");
  const nameField = el("label", "", "Your name");
  const name = el("input");
  name.required = true;
  name.maxLength = 60;
  name.autocomplete = "nickname";
  nameField.append(name);

  const titleField = el("label", "", "Album title");
  const title = el("input");
  title.required = true;
  title.maxLength = 80;
  title.placeholder = "Summer nights";
  titleField.append(title);

  const descField = el("label", "", "What is it about?");
  const description = el("textarea");
  description.required = true;
  description.maxLength = 400;
  description.rows = 3;
  descField.append(description);

  const submit = el("button", "primary", "Create album");
  submit.type = "submit";
  submit.dataset.sound = "tap";
  form.append(nameField, titleField, descField, submit);
  form.onsubmit = async (event) => {
    event.preventDefault();
    await attempt(submit, "Creating…", async () => {
      const album = await createAlbum({
        creator_name: name.value,
        title: title.value,
        description: description.value,
      });
      play("success");
      toast("Album created.");
      modal.close();
      onDone?.({
        id: album.id,
        slug: album.slug,
        title: album.title,
        description: album.description,
        creator_name: album.creator_name,
        created_at: album.created_at,
        album_items: [{ count: 0 }],
      });
    });
  };
  modal.body.append(form);
  modal.open();
  title.focus();
}

async function detail(slug) {
  const root = $("#albums");
  if (!root) return;
  const wrap = root.closest(".narrow") || root.parentElement;
  const data = await result(
    connected()
      .from("albums")
      .select(DETAIL_FIELDS)
      .eq("slug", slug)
      .maybeSingle(),
  );
  if (!data) {
    showEmpty(root, {
      icon: "?",
      title: "Album not found",
      body: "It may have been removed by a moderator, or the link is wrong.",
      action: "All albums",
      href: url("albums/"),
    });
    return;
  }

  // Swap the index markup for a single album view.
  const heading = document.createElement("header");
  heading.className = "page-heading reveal";
  const back = el("a", "back-link", "← All albums");
  back.href = url("albums/");
  back.dataset.sound = "nav";
  const eyebrow = el("span", "eyebrow", "Album");
  const title = el("h1", "", data.title);
  const lede = el("p", "", data.description);
  heading.append(back, eyebrow, title, lede);

  const meta = el("p", "hint", `By ${data.creator_name} · created ${date(data.created_at)}`);
  heading.append(meta);

  const addBar = el("div", "toolbar");
  const addPost = el("button", "primary", "Add a memory");
  const reportAlbum = el("button", "subtle", "Report");
  reportAlbum.dataset.sound = "tap";
  addBar.append(addPost, reportAlbum);

  const grid = el("div", "grid");
  grid.setAttribute("data-masonry", "");
  const holder = wrap || document.querySelector("main");
  holder.replaceChildren(heading, addBar, grid);
  document.title = `${data.title} · ${config.SITE_NAME}`;

  const posts = (data.posts || []).sort((a, b) =>
    a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1,
  );
  if (!posts.length)
    showEmpty(grid, {
      icon: "▦",
      title: "This album is empty",
      body: "Nothing has been added to it yet. Pick a memory and it will show up here.",
    });

  reportAlbum.onclick = () => openReport("album", data.id, data.title);
  addPost.onclick = () => openAddToAlbum(data, async () => {
    toast("Memory added.");
    await detail(slug);
  });

  const signed = await signPosts(posts);
  const list = signed;
  const nodes = list.map((post) => card(post, list));
  grid.classList.add("stagger");
  nodes.forEach((node, i) => node.style.setProperty("--i", String(i % 12)));
  grid.replaceChildren(...nodes);
  requestAnimationFrame(() => grid.classList.add("in"));
  bindGif(grid);
  watchMedia(grid);
  observe(holder);
}

function openAddToAlbum(album, onDone) {
  const modal = dialog("Add a memory");
  const status = el("p", "muted", "Loading the archive…");
  const grid = el("div", "grid");
  const list = el("div", "stack");
  const search = el("input");
  search.type = "search";
  search.placeholder = "Filter by name or caption";
  search.setAttribute("aria-label", "Filter memories");
  list.append(search, status, grid);
  modal.body.append(list);
  modal.open();
  search.focus();

  load().catch((error) => {
    status.textContent = error.message;
  });

  async function load() {
    const rows = await result(
      connected()
        .from("posts")
        .select("id,username,caption,media_type,storage_path,poster_path")
        .eq("status", "approved")
        .order("approved_at", { ascending: false })
        .limit(120),
    );
    status.textContent = `${rows.length} memories`;
    const signed = await signPosts(rows);

    function paint(filter = "") {
      const needle = filter.trim().toLowerCase();
      const shown = signed.filter(
        (post) =>
          !needle ||
          post.username.toLowerCase().includes(needle) ||
          post.caption.toLowerCase().includes(needle),
      );
      const nodes = shown.slice(0, 24).map((post) => {
        const button = el("button", "album-card");
        button.dataset.sound = "tap";
        const cover = el("div", "album-cover");
        cover.style.gridTemplateRows = "1fr";
        const cell = el("div", "slot");
        cell.style.gridColumn = "1 / -1";
        const thumb = el("img");
        thumb.src = post.poster || post.url;
        thumb.alt = "";
        thumb.loading = "lazy";
        cell.append(thumb);
        cover.append(cell);
        const body = el("div", "album-body");
        body.append(el("h3", "", post.username), el("p", "", post.caption));
        button.append(cover, body);
        button.onclick = () =>
          attempt(button, "Adding…", async () => {
            await addToAlbum(album.id, post.id);
            play("success");
            modal.close();
            onDone();
          });
        return button;
      });
      grid.classList.add("stagger");
      nodes.forEach((node, i) => node.style.setProperty("--i", String(i % 6)));
      grid.replaceChildren(...nodes);
      requestAnimationFrame(() => grid.classList.add("in"));
    }
    paint();
    search.oninput = () => paint(search.value);
  }
}

export function openReport(targetType, targetId, label) {
  const modal = dialog(`Report this ${targetType}`);
  const form = el("form", "stack");
  const reasonField = el("label", "", "What is wrong with it?");
  const reason = el("textarea");
  reason.required = true;
  reason.maxLength = 300;
  reason.rows = 3;
  reason.placeholder = "Spam, inappropriate content, something else…";
  reasonField.append(reason);
  const submit = el("button", "danger", "Send report");
  submit.type = "submit";
  submit.dataset.sound = "tap";
  form.append(reasonField, submit);
  form.onsubmit = async (event) => {
    event.preventDefault();
    await attempt(submit, "Sending…", async () => {
      await report({ target_type: targetType, target_id: targetId, reason: reason.value });
      play("success");
      toast("Thanks. A moderator will look at it.");
      modal.close();
    });
  };
  modal.body.append(el("p", "muted", label ? `Reporting "${label}"` : ""), form);
  modal.open();
  reason.focus();
}

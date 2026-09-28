import { connected, result, signPosts, ready } from "./data.js";
import { $, $$, el, showEmpty, url, date } from "./ui.js";
import { card } from "./gallery.js";
import { play } from "./sound.js";
import { observe, bindGif, watchMedia } from "./motion.js";

const CACHE_KEY = "archive:search:v3";
// Deliberately narrow. The cached index holds text only, so it can never carry a
// file path or a short lived signed url into local storage. Media for the rows
// that actually match is fetched fresh and signed on demand.
const INDEX_FIELDS = "id,username,caption,media_type,created_at,likes,tags(name)";
const MEDIA_FIELDS =
  "id,username,caption,media_type,created_at,likes,storage_path,poster_path,width,height,tags(name),comments(count)";

let worker = null;
let rows = [];
let byId = new Map();
let pending = null;

// The index is cached locally so a repeat visit searches instantly.
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rows) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

async function fetchRows() {
  const posts = await result(
    connected()
      .from("posts")
      .select(INDEX_FIELDS)
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(2000),
  );
  return posts.map((post) => ({
    id: post.id,
    username: post.username,
    caption: post.caption,
    media_type: post.media_type,
    created_at: post.created_at,
    likes: post.likes,
    tags: (post.tags || []).map((tag) => tag.name),
  }));
}

// Media lives outside the cache. Only the rows that matched get signed.
async function fetchMedia(ids) {
  if (!ids.length) return [];
  const posts = await result(
    connected()
      .from("posts")
      .select(MEDIA_FIELDS)
      .in("id", ids)
      .eq("status", "approved"),
  );
  const order = new Map(ids.map((id, index) => [id, index]));
  posts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return signPosts(posts);
}

function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./search-index.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const { type, total, hits, count } = event.data;
    if (type === "indexed") return;
    if (type !== "results" || !pending) return;
    const { resolve } = pending;
    pending = null;
    resolve({ total, hits });
  };
  return worker;
}

function ask(message) {
  const instance = startWorker();
  return new Promise((resolve) => {
    pending = { resolve };
    instance.postMessage(message);
  });
}

export async function search() {
  const form = $("#search-form");
  const input = $("#q");
  const results = $("#results");
  const status = $("#search-status");
  const clear = $("#clear");
  if (!form || !input) return;

  let filter = "all";
  let dateWindow = 0;
  let sequence = 0;
  let all = [];

  if (!ready()) {
    showEmpty(results, {
      icon: "⚡",
      title: "Not connected yet",
      body: "Search cannot reach the archive right now. Give it a moment and refresh.",
    });
    return;
  }

  const params = new URLSearchParams(location.search);
  if (params.get("tag")) input.value = `#${params.get("tag")}`;
  if (params.get("q")) input.value = params.get("q");

  function pushState() {
    const next = new URL(location.href);
    if (input.value.trim()) next.searchParams.set("q", input.value.trim());
    else next.searchParams.delete("q");
    history.replaceState(null, "", next);
  }

  function paint(count, total) {
    clear.hidden = !input.value;
    if (!input.value.trim()) {
      status.textContent = total ? `${total} memories indexed` : "";
      return;
    }
    status.textContent = count
      ? `${count} result${count === 1 ? "" : "s"}`
      : "Nothing matched that search.";
    if (total > count && count)
      status.textContent += `, showing the top ${count}`;
  }

  function highlight(node, query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return;
    const regex = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    for (const target of targets) {
      if (!target.nodeValue.trim()) continue;
      const fragment = document.createDocumentFragment();
      let last = 0;
      for (const match of target.nodeValue.matchAll(regex)) {
        if (match.index > last)
          fragment.append(target.nodeValue.slice(last, match.index));
        const mark = el("mark", "", match[0]);
        fragment.append(mark);
        last = match.index + match[0].length;
      }
      if (last) {
        fragment.append(target.nodeValue.slice(last));
        target.replaceWith(fragment);
      }
    }
  }

  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  async function run() {
    const query = input.value.trim();
    pushState();
    const ticket = ++sequence;

    if (!query) {
      results.classList.remove("stagger", "in");
      showEmpty(results, {
        icon: "⌕",
        title: "Search the whole archive",
        body: "Type a name, a caption or a tag. Everything in the collection is searchable.",
      });
      paint(0, all.length);
      return;
    }

    status.textContent = "Searching…";
    const { total, hits } = await ask({
      type: "query",
      query,
      filter,
      dateWindow,
    });
    if (ticket !== sequence) return;

    const matched = hits.filter((id) => byId.has(id));
    paint(matched.length, total);

    if (!matched.length) {
      results.classList.remove("stagger", "in");
      showEmpty(results, {
        icon: "⌕",
        title: "Nothing matched",
        body: `No memory mentions "${query}". Try a shorter word, a different spelling, or a tag.`,
        action: "Browse everything instead",
        href: url("gallery/"),
      });
      return;
    }

    // Only the rows that matched get their media fetched and signed.
    const list = await fetchMedia(matched.slice(0, 60));
    if (ticket !== sequence) return;
    const nodes = list.map((post) => card(post, list));
    results.classList.remove("in");
    results.replaceChildren(...nodes);
    results.classList.add("stagger");
    nodes.forEach((node, i) => node.style.setProperty("--i", String(i % 12)));
    requestAnimationFrame(() => results.classList.add("in"));
    const caption = $(".caption", results);
    if (caption) highlight(caption, query);
    for (const tagNode of $$(".tag-link", results)) highlight(tagNode, query);
    bindGif(results);
    watchMedia(results);
    observe(results);
  }

  let debounce;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(run, 140);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(debounce);
    run();
  });
  clear.onclick = () => {
    input.value = "";
    input.focus();
    play("close");
    run();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      input.value = "";
      run();
    }
  });

  $$("[data-filter]").forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.filter;
      $$("[data-filter]").forEach((other) =>
        other.setAttribute("aria-pressed", String(other === button)),
      );
      play("tap");
      run();
    };
  });
  $$("[data-date]").forEach((button) => {
    button.onclick = () => {
      dateWindow = Number(button.dataset.date);
      $$("[data-date]").forEach((other) =>
        other.setAttribute("aria-pressed", String(other === button)),
      );
      play("tap");
      run();
    };
  });

  // Slash focuses the field, like a proper search box.
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== input) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      input.focus();
      input.select();
    }
  });

  // Use the cache first, then refresh in the background.
  const cached = readCache();
  const source = cached?.rows?.length ? cached.rows : await fetchRows();
  all = source;
  byId = new Map(source.map((row) => [row.id, row]));
  await ask({ type: "index", rows: source });
  if (!cached?.rows?.length) writeCache({ savedAt: Date.now(), rows: source });
  paint(0, all.length);
  if (input.value.trim()) run();
}

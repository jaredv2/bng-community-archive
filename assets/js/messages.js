import { db, connected, result, ready } from "./data.js";
import { $, el, showEmpty, attempt, toast, date, fieldError } from "./ui.js";
import { text } from "./validation.js";
import { play } from "./sound.js";
import { observe } from "./motion.js";

export function commentCard(row) {
  const node = el("article", "message");
  const meta = el("div", "comment-meta");
  meta.append(el("strong", "", row.name), el("span", "muted", date(row.created_at)));
  node.append(meta, el("p", "", row.content));
  return node;
}

export async function messages(root, home = false) {
  if (!ready()) {
    showEmpty(root, {
      icon: "⚡",
      title: "Not connected yet",
      body: "The wall cannot load right now. Give it a moment and refresh.",
    });
    return;
  }

  let limit = home ? 3 : 20;
  const more = $("#messages-more");
  let version = 0;

  async function load() {
    const request = ++version;
    try {
      const rows = await result(
        connected()
          .from("messages")
          .select("id,name,content,created_at")
          .order("created_at", { ascending: false })
          .order("id")
          .limit(limit),
      );
      if (request !== version) return;
      const nodes = rows.map(commentCard);
      root.classList.remove("in");
      if (!rows.length) {
        showEmpty(root, {
          icon: "✎",
          title: "The wall is blank",
          body: "No one has written anything yet. A hello, an inside joke, something to remember.",
        });
        return;
      }
      root.classList.add("stagger");
      nodes.forEach((node, i) => node.style.setProperty("--i", String(i % 9)));
      root.replaceChildren(...nodes);
      requestAnimationFrame(() => root.classList.add("in"));
      observe(root);
      if (more) more.hidden = home || rows.length < limit;
    } catch (error) {
      showEmpty(root, { icon: "!", title: "Could not load the wall", body: error.message });
      if (more) more.hidden = true;
    }
  }

  if (more) {
    more.onclick = () => {
      limit += 20;
      return attempt(more, "Loading…", load);
    };
  }

  await load();

  // New messages appear without a refresh.
  let timer;
  const channel = db
    .channel(`wall-${home ? "home" : "page"}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          load();
          play("tick");
        }, 320);
      },
    )
    .subscribe();
  window.addEventListener(
    "pagehide",
    () => {
      clearTimeout(timer);
      db.removeChannel(channel);
    },
    { once: true },
  );

  const form = $("#message-form");
  if (!form) return;
  const name = $("#message-name");
  const content = $("#message-content");
  form.onsubmit = (event) => {
    event.preventDefault();
    attempt($("button", form), "Posting…", async () => {
      try {
        await result(
          connected()
            .from("messages")
            .insert({
              name: text(name.value, 60, "Name"),
              content: text(content.value, 2000, "Message"),
            }),
        );
        play("success");
        form.reset();
        fieldError(name, null);
        fieldError(content, null);
        await load();
        toast("Message posted.");
      } catch (error) {
        if (error.message?.startsWith("Name must")) fieldError(name, error.message);
        if (error.message?.startsWith("Message must")) fieldError(content, error.message);
        throw error;
      }
    });
  };
}

import { db, connected, result } from "./supabase.js";
import { $, el, empty, busy, toast } from "./ui.js";
import { commentCard } from "./gallery.js";
import { text } from "./validation.js";
export async function messages(root, home = false) {
  let limit = home ? 3 : 20;
  const more = el("button", "load-more", "Load more messages");
  if (!home) root.after(more);
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
      root.replaceChildren(...rows.map(commentCard));
      if (!rows.length) empty(root, "No messages yet. Leave the first hello.");
      more.hidden = home || rows.length < limit;
    } catch (e) {
      empty(root, e.message);
      more.hidden = true;
    }
  }
  more.onclick = () => {
    limit += 20;
    return busy(more, "Loading…", load);
  };
  await load();
  if (db) {
    let timer;
    const channel = db
      .channel(`wall-${home}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          clearTimeout(timer);
          timer = setTimeout(load, 300);
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
  }
  const form = $("#message-form");
  if (form)
    form.onsubmit = (e) => {
      e.preventDefault();
      busy($("button", form), "Posting…", async () => {
        const data = new FormData(form);
        await result(
          connected()
            .from("messages")
            .insert({
              name: text(data.get("name"), 60, "Name"),
              content: text(data.get("content"), 2000, "Message"),
            }),
        );
        form.reset();
        await load();
        toast("Message posted.");
      });
    };
}

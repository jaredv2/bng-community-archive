import { db, connected, result, api } from "./supabase.js";
import { $, el, busy, empty, toast, confirmReject, date } from "./ui.js";
import { media } from "./gallery.js";
export async function admin() {
  const login = $("#admin-login"),
    dashboard = $("#dashboard"),
    root = $("#admin-posts");
  let status = "pending",
    page = 0;
  const more = $("#admin-more");
  async function load(reset = true) {
    if (reset) {
      page = 0;
      empty(root, "Loading submissions…");
    }
    try {
      const { posts } = await api("list", { status, page });
      if (!page) root.replaceChildren();
      if (!page && !posts.length)
        empty(
          root,
          status === "pending"
            ? "No submissions waiting for approval."
            : "No approved posts yet.",
        );
      for (const post of posts) {
        const n = el("article", "post-card");
        n.append(media(post, post.url, true));
        const body = el("div", "post-body");
        body.append(
          el("strong", "", post.username),
          el("p", "", post.caption),
          el("p", "muted", `${post.media_type} · ${date(post.created_at)}`),
        );
        const actions = el("div", "actions");
        for (const [label, action] of status === "pending"
          ? [
              ["Approve", "approve"],
              ["Reject", "reject"],
            ]
          : [[post.pinned ? "Unpin" : "Pin", "pin"]]) {
          const b = el(
            "button",
            action === "reject" ? "danger" : "primary",
            label,
          );
          b.onclick = async () => {
            if (action === "reject" && !(await confirmReject())) return;
            busy(b, "Saving…", async () => {
              await api(action, { id: post.id, pinned: !post.pinned });
              toast(
                action === "approve"
                  ? "Submission approved."
                  : action === "reject"
                    ? "Submission rejected."
                    : post.pinned
                      ? "Post unpinned."
                      : "Post pinned.",
              );
              await load();
            });
          };
          actions.append(b);
        }
        body.append(actions);
        n.append(body);
        root.append(n);
      }
      more.hidden = posts.length < 20;
      page++;
    } catch (e) {
      empty(root, e.message);
      more.hidden = true;
    }
  }
  more.onclick = () => busy(more, "Loading…", () => load(false));
  async function check() {
    try {
      connected();
      const session = await result(db.auth.getSession());
      if (!session.session) throw new Error("Sign in to continue.");
      if (!(await result(db.rpc("is_admin")))) {
        await db.auth.signOut();
        throw new Error(
          "Administrator access is unavailable or expired. Sign in again.",
        );
      }
      login.hidden = true;
      dashboard.hidden = false;
      await load();
    } catch (e) {
      login.hidden = false;
      dashboard.hidden = true;
      $("#admin-status").textContent = e.message;
    }
  }
  login.onsubmit = (e) => {
    e.preventDefault();
    busy($("button", login), "Signing in…", async () => {
      const data = new FormData(login);
      await result(
        connected().auth.signInWithPassword({
          email: data.get("email"),
          password: data.get("password"),
        }),
      );
      login.reset();
      await check();
    });
  };
  $("#logout").onclick = () =>
    busy($("#logout"), "Signing out…", async () => {
      await result(connected().auth.signOut());
      await check();
    });
  document.querySelectorAll("[data-status]").forEach(
    (b) =>
      (b.onclick = () => {
        status = b.dataset.status;
        document
          .querySelectorAll("[data-status]")
          .forEach((t) => t.setAttribute("aria-pressed", String(t === b)));
        load();
      }),
  );
  await check();
  const timer = setInterval(async () => {
    if (
      !dashboard.hidden &&
      db &&
      !(await result(db.rpc("is_admin")).catch(() => false))
    )
      check();
  }, 60000);
  window.addEventListener("pagehide", () => clearInterval(timer));
}

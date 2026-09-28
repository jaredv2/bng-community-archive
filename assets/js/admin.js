import { db, connected, result, api, ready } from "./data.js";
import { $, $$, el, attempt, empty, loading, toast, date, confirmAction } from "./ui.js";
import { mediaNode } from "./lightbox.js";
import { play } from "./sound.js";
import { observe } from "./motion.js";

const queueCard = (post, reload) => {
  const cardNode = el("article", "admin-card");
  cardNode.append(mediaNode(post, { full: true, poster: true }));
  const body = el("div", "admin-body");
  body.append(
    el("strong", "", post.username),
    el("p", "", post.caption),
    el("p", "muted", `${post.media_type} · ${date(post.created_at)}`),
  );
  if (post.tags?.length)
    body.append(el("div", "card-tags", post.tags.map((tag) => `#${tag.name}`).join("   ")));

  const actions = el("div", "actions");
  const options = [
    [post.pinned ? "Unpin" : "Pin", "pin", "subtle"],
    ["Remove", "unpublish", "danger"],
  ];

  for (const [label, action, variant] of options) {
    const button = el("button", variant, label);
    button.dataset.sound = "tap";
    button.onclick = async () => {
      if (action === "unpublish") {
        const yes = await confirmAction({
          title: "Take this down?",
          body: "It leaves the archive and the files are deleted. This cannot be undone.",
          confirmLabel: "Remove",
          danger: true,
        });
        if (!yes) return;
      }
      await attempt(button, "Saving…", async () => {
        await api(action, { id: post.id, pinned: !post.pinned });
        play("success");
        toast(action === "unpublish" ? "Removed from the archive." : post.pinned ? "Unpinned." : "Pinned.");
        await reload();
      });
    };
    actions.append(button);
  }
  body.append(actions);
  cardNode.append(body);
  return cardNode;
};

export async function admin() {
  const login = $("#admin-login");
  const dashboard = $("#dashboard");
  const queueRoot = $("#admin-posts");
  const more = $("#admin-more");
  if (!login) return;
  let page = 0;

  async function loadQueue(reset = true) {
    if (reset) {
      page = 0;
      loading(queueRoot, "Loading memories");
    }
    try {
      const { posts } = await api("list", { status: "approved", page });
      if (!page) queueRoot.replaceChildren();
      if (!page && !posts.length) empty(queueRoot, "Nothing has been shared yet.");
      for (const post of posts) queueRoot.append(queueCard(post, loadQueue));
      if (more) more.hidden = posts.length < 20;
      page++;
    } catch (error) {
      empty(queueRoot, error.message);
      if (more) more.hidden = true;
    }
  }
  if (more) more.onclick = () => attempt(more, "Loading…", () => loadQueue(false));

  async function loadAlbums() {
    const root = $("#admin-albums");
    if (!root) return;
    loading(root, "Loading albums");
    try {
      const albums = await api("admin-albums");
      if (!albums.length) {
        empty(root, "No albums have been created yet.");
        return;
      }
      root.replaceChildren(
        ...albums.map((album) => {
          const row = el("div", "row");
          const body = el("div", "row-body");
          body.append(
            el("strong", "", album.title),
            el(
              "span",
              "",
              `${album.count} memories · by ${album.creator_name} · ${date(album.created_at)}`,
            ),
          );
          const actions = el("div", "row-actions");
          for (const [label, action] of [
            ["Hide", "hide"],
            ["Show", "show"],
            ["Delete", "delete"],
          ]) {
            if (action === "hide" && album.hidden) continue;
            if (action === "show" && !album.hidden) continue;
            const button = el("button", action === "delete" ? "danger" : "subtle", label);
            button.dataset.sound = "tap";
            button.onclick = async () => {
              if (action === "delete") {
                const yes = await confirmAction({
                  title: "Delete this album?",
                  body: "The album and its layout go away. The memories inside stay in the archive.",
                  confirmLabel: "Delete",
                  danger: true,
                });
                if (!yes) return;
              }
              await attempt(button, "Saving…", async () => {
                await api(`album-${action}`, { id: album.id });
                play("success");
                toast(`${label} done.`);
                await loadAlbums();
              });
            };
            actions.append(button);
          }
          row.append(body, actions);
          return row;
        }),
      );
    } catch (error) {
      empty(root, error.message);
    }
  }

  async function loadReports() {
    const root = $("#admin-reports");
    if (!root) return;
    loading(root, "Loading reports");
    try {
      const reports = await api("admin-reports");
      if (!reports.length) {
        empty(root, "No reports have come in.");
        return;
      }
      root.replaceChildren(
        ...reports.map((item) => {
          const row = el("div", "row");
          const body = el("div", "row-body");
          body.append(
            el("strong", "", `${item.target_type} · ${item.title || item.target_id}`),
            el("span", "", `${item.reason} · ${date(item.created_at)}`),
          );
          const actions = el("div", "row-actions");
          for (const [label, action] of [
            ["Dismiss", "dismiss"],
            ["Hide item", "hide-item"],
          ]) {
            const button = el("button", "subtle", label);
            button.dataset.sound = "tap";
            button.onclick = async () =>
              attempt(button, "Saving…", async () => {
                await api(`report-${action}`, { id: item.id, target_id: item.target_id, target_type: item.target_type });
                play("success");
                toast("Done.");
                await loadReports();
              });
            actions.append(button);
          }
          row.append(body, actions);
          return row;
        }),
      );
    } catch (error) {
      empty(root, error.message);
    }
  }

  function showTab(name) {
    for (const tab of $$("[data-tab]"))
      tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    for (const panel of ["queue", "albums", "reports"]) {
      const node = $(`#panel-${panel}`);
      if (node) node.hidden = panel !== name;
    }
    if (name === "albums") loadAlbums();
    if (name === "reports") loadReports();
  }
  $$("[data-tab]").forEach((tab) => {
    tab.onclick = () => {
      showTab(tab.dataset.tab);
      play("tap");
    };
  });

  async function check() {
    try {
      connected();
      const { data } = await db.auth.getSession();
      if (!data.session) throw new Error("Sign in to continue.");
      if (!(await result(db.rpc("is_admin"))))
        throw new Error("Admin access is unavailable or expired. Sign in again.");
      login.hidden = true;
      dashboard.hidden = false;
      await loadQueue();
    } catch (error) {
      login.hidden = false;
      dashboard.hidden = true;
      $("#admin-status").textContent = error.message;
    }
  }

  login.onsubmit = (event) => {
    event.preventDefault();
    attempt($("button", login), "Signing in…", async () => {
      const data = new FormData(login);
      await result(
        connected().auth.signInWithPassword({
          email: data.get("email"),
          password: data.get("password"),
        }),
      );
      login.reset();
      play("success");
      await check();
    });
  };

  $("#logout").onclick = () =>
    attempt($("#logout"), "Signing out…", async () => {
      await result(connected().auth.signOut());
      await check();
    });

  if (!ready()) {
    $("#admin-status").textContent = "The archive is not connected yet.";
    return;
  }
  await check();

  const timer = setInterval(async () => {
    if (dashboard.hidden || !db) return;
    const allowed = await result(db.rpc("is_admin")).catch(() => false);
    if (!allowed) check();
  }, 60000);
  window.addEventListener("pagehide", () => clearInterval(timer));
  observe(document);
}

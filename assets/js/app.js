import { shell, $ } from "./ui.js";
import { loadGallery } from "./gallery.js";
import { messages } from "./messages.js";
import "./webmcp.js";
shell();
const page = document.body.dataset.page;
if (page === "home") {
  loadGallery($("#posts"), 3, { home: true });
  messages($("#messages"), true);
}
if (page === "gallery") loadGallery($("#posts"));
if (page === "messages") messages($("#messages"));
if (page === "submit") import("./submit.js").then((m) => m.submission());
if (page === "adminpanel") import("./admin.js").then((m) => m.admin());

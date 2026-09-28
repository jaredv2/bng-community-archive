import { shell, $ } from "./ui.js";
import { loadGallery } from "./gallery.js";
import { messages } from "./messages.js";
import { observe } from "./motion.js";
import "./webmcp.js";

shell();
const page = document.body.dataset.page;

const routes = {
  home: async () => {
    await loadGallery($("#posts"), { home: true });
    await messages($("#messages"), true);
  },
  gallery: () => loadGallery($("#posts")),
  albums: () => import("./albums.js").then((module) => module.albums()),
  search: () => import("./search.js").then((module) => module.search()),
  submit: () => import("./submit.js").then((module) => module.submission()),
  messages: () => messages($("#messages")),
  adminpanel: () => import("./admin.js").then((module) => module.admin()),
};

const start = routes[page];
if (start) start().catch((error) => console.error(error));
observe(document);

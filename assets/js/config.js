// Placeholder only. The real values are read from .env at build time and written
// into dist/, which is gitignored. This file must never hold a live key.
export const config = Object.freeze({
  API_URL: "REPLACE_WITH_PROJECT_URL",
  API_KEY: "REPLACE_WITH_PROJECT_KEY",
  SITE_NAME: "Community Archive",
  ARCHIVE_NAME: "BNG",
  MAX_IMAGE_SIZE: 25 * 1024 * 1024,
  MAX_VIDEO_SIZE: 50 * 1024 * 1024,
  POSTS_PER_PAGE: 20,
  MAX_TAGS: 5,
  COMMENTS_PER_PAGE: 50,
});

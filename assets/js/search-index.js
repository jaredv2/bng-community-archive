// Ranking happens here so typing never blocks the main thread.
let rows = [];

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

// Cheap edit distance, capped so long words stay fast.
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (current[j] < best) best = current[j];
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

const typoAllowance = (word) => (word.length > 7 ? 2 : word.length > 3 ? 1 : 0);

// Subsequence match so "bfr" still finds "before".
function subsequence(haystack, needle) {
  let at = 0;
  for (const character of needle) {
    at = haystack.indexOf(character, at);
    if (at === -1) return false;
    at++;
  }
  return true;
}

function fieldScore(field, term) {
  if (!field) return 0;
  const index = field.indexOf(term);
  if (index === 0) return 100;
  if (index > 0) return field[index - 1] === " " ? 80 : 55;
  return 0;
}

function scoreRow(row, terms) {
  const caption = normalize(row.caption);
  const username = normalize(row.username);
  const tags = row.tags || [];
  const tagText = tags.map(normalize);
  let total = 0;
  let matched = 0;

  for (const term of terms) {
    let best = 0;
    best = Math.max(best, fieldScore(caption, term) * 1.0);
    best = Math.max(best, fieldScore(username, term) * 0.9);
    for (const tag of tagText) {
      if (tag === term) best = Math.max(best, 120);
      else best = Math.max(best, fieldScore(tag, term) * 1.1);
    }
    if (!best) {
      const allowance = typoAllowance(term);
      if (allowance) {
        for (const token of `${caption} ${username} ${tagText.join(" ")}`.split(/[^a-z0-9]+/)) {
          if (!token) continue;
          if (token.startsWith(term.slice(0, Math.max(2, term.length - allowance)))) {
            best = Math.max(best, 30);
            break;
          }
          if (distance(token, term, allowance) <= allowance) {
            best = Math.max(best, 24);
            break;
          }
        }
      }
      if (!best && term.length >= 3 && subsequence(caption.replace(/[^a-z0-9]/g, ""), term.replace(/[^a-z0-9]/g, "")))
        best = 12;
    }
    if (best) matched++;
    total += best;
  }

  if (!matched) return 0;
  // Reward rows that matched every term.
  return total * (matched / terms.length) * (1 + matched * 0.12);
}

self.onmessage = (event) => {
  const { type } = event.data;
  if (type === "index") {
    rows = event.data.rows;
    self.postMessage({ type: "indexed", count: rows.length });
    return;
  }
  if (type !== "query") return;

  const { query, filter, dateWindow } = event.data;
  const terms = normalize(query).split(/\s+/).filter(Boolean);

  if (!terms.length) {
    self.postMessage({ type: "results", total: rows.length, hits: [] });
    return;
  }

  const cutoff = dateWindow ? Date.now() - dateWindow * 86400000 : 0;
  const scored = [];
  for (const row of rows) {
    if (filter !== "all" && row.media_type !== filter) continue;
    if (cutoff && new Date(row.created_at).getTime() < cutoff) continue;
    const score = scoreRow(row, terms);
    if (score > 0) scored.push({ id: row.id, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  self.postMessage({
    type: "results",
    total: scored.length,
    hits: scored.slice(0, 200).map((entry) => entry.id),
  });
};

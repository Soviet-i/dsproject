const fs = require("fs");
const path = require("path");

const CULTURE_PATH = path.resolve(__dirname, "../data/stationCultureTree.json");

let cache = null;

function normalizeText(v) {
  return String(v || "").trim();
}

function normalizeTextArray(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const t = normalizeText(item);
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normalizeStation(raw) {
  const station_name = normalizeText(raw && raw.station_name);
  if (!station_name) return null;
  return {
    station_name,
    tree_path: normalizeTextArray(raw && raw.tree_path),
    culture_tags: normalizeTextArray(raw && raw.culture_tags),
    culture_types: normalizeTextArray(raw && raw.culture_types),
    story_summary: normalizeText(raw && raw.story_summary),
    recommended_topics: normalizeTextArray(raw && raw.recommended_topics),
    nearby_pois: normalizeTextArray(raw && raw.nearby_pois),
    audience_fit: normalizeTextArray(raw && raw.audience_fit),
    popularity: Number.isFinite(Number(raw && raw.popularity)) ? Number(raw.popularity) : 0,
    confidence: Number.isFinite(Number(raw && raw.confidence)) ? Number(raw.confidence) : 0,
    why_recommend: normalizeText(raw && raw.why_recommend),
    line_affinity: normalizeTextArray(raw && raw.line_affinity),
    book_source: normalizeText(raw && raw.book_source),
    book_excerpt: normalizeText(raw && raw.book_excerpt)
  };
}

function buildTree(stations) {
  const root = new Map();

  for (const station of stations) {
    const pathArr = station.tree_path;
    let layer = root;
    for (const segment of pathArr) {
      if (!layer.has(segment)) {
        layer.set(segment, { name: segment, count: 0, children: new Map() });
      }
      const node = layer.get(segment);
      node.count += 1;
      layer = node.children;
    }
  }

  const toArray = (map) => {
    return Array.from(map.values())
      .map((node) => ({
        name: node.name,
        count: node.count,
        children: toArray(node.children)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  };

  return toArray(root);
}

function ensureCache() {
  if (cache) return cache;

  let raw = { stations: [] };
  try {
    raw = JSON.parse(fs.readFileSync(CULTURE_PATH, "utf8"));
  } catch {
    raw = { stations: [] };
  }
  const inputStations = Array.isArray(raw.stations) ? raw.stations : [];
  const stations = inputStations.map(normalizeStation).filter(Boolean);
  const byName = new Map(stations.map((s) => [s.station_name, s]));
  const tree = buildTree(stations);

  cache = { stations, byName, tree };
  return cache;
}

function isPathPrefix(pathArr, prefixArr) {
  if (prefixArr.length === 0) return true;
  if (pathArr.length < prefixArr.length) return false;
  for (let i = 0; i < prefixArr.length; i += 1) {
    if (pathArr[i] !== prefixArr[i]) return false;
  }
  return true;
}

function getCultureTree() {
  const c = ensureCache();
  return {
    tree: c.tree,
    totalStations: c.stations.length
  };
}

function getStationsByPath(pathArr) {
  const c = ensureCache();
  const prefix = normalizeTextArray(pathArr);
  return c.stations.filter((s) => isPathPrefix(s.tree_path, prefix));
}

function jaccardScore(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const item of sa) {
    if (sb.has(item)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  return union > 0 ? inter / union : 0;
}

function commonPrefixLength(a, b) {
  const m = Math.min(a.length, b.length);
  let i = 0;
  while (i < m && a[i] === b[i]) i += 1;
  return i;
}

function buildReason(base, candidate) {
  const reasons = [];
  const prefixLen = commonPrefixLength(base.tree_path, candidate.tree_path);
  if (prefixLen > 0) {
    reasons.push(`同属主题：${base.tree_path.slice(0, prefixLen).join(" > ")}`);
  }
  const sharedTags = base.culture_tags.filter((t) => candidate.culture_tags.includes(t)).slice(0, 3);
  if (sharedTags.length > 0) {
    reasons.push(`共享标签：${sharedTags.join("、")}`);
  }
  const sharedTypes = base.culture_types.filter((t) => candidate.culture_types.includes(t)).slice(0, 2);
  if (sharedTypes.length > 0) {
    reasons.push(`同类属性：${sharedTypes.join("、")}`);
  }
  return reasons;
}

function getSimilarStations(stationName, topK = 5) {
  const c = ensureCache();
  const key = normalizeText(stationName);
  const base = c.byName.get(key);
  if (!base) {
    return {
      stationName: key,
      similarStations: []
    };
  }

  const candidates = [];
  for (const candidate of c.stations) {
    if (candidate.station_name === base.station_name) continue;

    const prefix = commonPrefixLength(base.tree_path, candidate.tree_path);
    const maxDepth = Math.max(base.tree_path.length, candidate.tree_path.length, 1);
    const pathScore = prefix / maxDepth;
    const tagScore = jaccardScore(base.culture_tags, candidate.culture_tags);
    const typeScore = jaccardScore(base.culture_types, candidate.culture_types);
    const lineScore = jaccardScore(base.line_affinity, candidate.line_affinity);
    const popScore = Math.max(0, Math.min(1, Number(candidate.popularity || 0)));

    const score = pathScore * 0.45 + tagScore * 0.3 + typeScore * 0.12 + lineScore * 0.08 + popScore * 0.05;
    candidates.push({
      station_name: candidate.station_name,
      tree_path: candidate.tree_path,
      culture_tags: candidate.culture_tags,
      culture_types: candidate.culture_types,
      story_summary: candidate.story_summary,
      score: Number(score.toFixed(4)),
      reasons: buildReason(base, candidate)
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.station_name.localeCompare(b.station_name, "zh-Hans-CN"));
  const limit = Number.isFinite(Number(topK)) ? Math.max(1, Math.min(20, Number(topK))) : 5;
  return {
    stationName: base.station_name,
    similarStations: candidates.slice(0, limit)
  };
}

function normalizeLineKeys(lineLabel) {
  const src = normalizeText(lineLabel).replace(/^地铁/u, "");
  const keys = new Set();
  if (!src) return [];
  const m = src.match(/(\d+)\s*号线/u);
  if (m) keys.add(`${m[1]}号线`);
  if (/八通/u.test(src)) keys.add("八通线");
  if (/S1|磁悬浮/u.test(src)) keys.add("S1线");
  if (/西郊|有轨/u.test(src)) keys.add("西郊线");
  if (/大兴机场/u.test(src)) keys.add("大兴机场线");
  if (/首都机场|机场线/u.test(src)) keys.add("首都机场线");
  if (/亦庄/u.test(src)) keys.add("亦庄线");
  if (/昌平/u.test(src)) keys.add("昌平线");
  if (/房山/u.test(src)) keys.add("房山线");
  if (/燕房/u.test(src)) keys.add("燕房线");
  if (keys.size === 0 && src) keys.add(src);
  return Array.from(keys);
}

function lineAffinityMatches(station, lineKeys) {
  if (!lineKeys || lineKeys.length === 0) return false;
  const aff = station.line_affinity || [];
  return lineKeys.some(
    (lineKey) =>
      aff.some((a) => a === lineKey || a.includes(lineKey) || lineKey.includes(a))
  );
}

function getStationByName(stationName) {
  const c = ensureCache();
  const key = normalizeText(stationName);
  return c.byName.get(key) || null;
}

function getStationsByLine(lineLabel, limit = 12) {
  const c = ensureCache();
  const lineKeys = normalizeLineKeys(lineLabel);
  if (lineKeys.length === 0) return [];
  const matched = c.stations.filter((s) => lineAffinityMatches(s, lineKeys));
  matched.sort(
    (a, b) =>
      (Number(b.popularity) || 0) - (Number(a.popularity) || 0) ||
      a.station_name.localeCompare(b.station_name, "zh-Hans-CN")
  );
  const cap = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(30, Number(limit))) : 12;
  return matched.slice(0, cap);
}

function formatCultureContextForPrompt(station, language) {
  if (!station) return "";
  if (language === "en") {
    return [
      "## Knowledge graph (ground truth — prefer these facts)",
      `Station (Chinese canonical): ${station.station_name}`,
      `Summary: ${station.story_summary}`,
      station.culture_tags?.length ? `Tags: ${station.culture_tags.join(", ")}` : "",
      station.nearby_pois?.length ? `Nearby POIs: ${station.nearby_pois.join(", ")}` : "",
      station.book_excerpt
        ? `Book excerpt (condense; do not invent beyond this):\n${station.book_excerpt.slice(0, 1200)}`
        : ""
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "## 知识图谱参考（请优先采信，勿与下列史实矛盾）",
    `站点：${station.station_name}`,
    `分类：${(station.tree_path || []).join(" > ")}`,
    `概要：${station.story_summary}`,
    station.culture_tags?.length ? `标签：${station.culture_tags.join("、")}` : "",
    station.nearby_pois?.length ? `周边参考：${station.nearby_pois.join("、")}` : "",
    station.book_excerpt
      ? `《北京地铁站名掌故》摘录（可改写润色，勿编造书中未提及的具体年代与人物细节）：\n${station.book_excerpt.slice(0, 1500)}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatLineCultureContextForPrompt(lineLabel, stations, language) {
  if (!stations || stations.length === 0) return "";
  const bullets = stations
    .map((s) => {
      const summary = (s.story_summary || "").slice(0, 120);
      if (language === "en") {
        return `- ${s.station_name}: ${summary}`;
      }
      return `- ${s.station_name}：${summary}`;
    })
    .join("\n");

  if (language === "en") {
    return [
      "## Line knowledge graph (sample stations along this line)",
      `Line label: ${lineLabel}`,
      "Use these station facts when weaving a corridor overview; do not invent dates or transfers.",
      bullets
    ].join("\n");
  }
  return [
    "## 线路知识图谱（沿线站点掌故摘要，撰写线路介绍时请参照）",
    `线路：${lineLabel}`,
    "以下摘自《北京地铁站名掌故》与站内知识图谱，可择要融入线路综述，勿编造无据细节。",
    bullets
  ].join("\n");
}

module.exports = {
  getCultureTree,
  getStationsByPath,
  getSimilarStations,
  getStationByName,
  getStationsByLine,
  formatCultureContextForPrompt,
  formatLineCultureContextForPrompt
};

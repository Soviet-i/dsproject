/**
 * Parse 《北京地铁站名掌故》 EPUB XHTML and merge into stationCultureTree.json.
 * Run: node Backend/scripts/importCultureFromBook.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BOOK_TEXT_DIR = path.resolve(ROOT, "../北京地铁站名掌故/OEBPS/Text");
const CULTURE_PATH = path.resolve(__dirname, "../data/stationCultureTree.json");
const METRO_PATH = path.resolve(__dirname, "../data/metro_adjacency.json");
const DISPLAY_TO_ZH_PATH = path.resolve(__dirname, "../data/metroStationDisplayToZh.json");

/** Book / legacy aliases → canonical metro station name */
const STATION_ALIASES = {
  八角游乐园: "八角游乐园",
  "八角游乐园站": "八角游乐园",
  军事博物馆: "军事博物馆",
  "Military Museum": "军事博物馆",
  植物园: "国家植物园",
  国家植物园: "国家植物园",
};

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStationKey(name) {
  return String(name || "")
    .trim()
    .replace(/站$/u, "")
    .replace(/\s+/g, "");
}

function loadMetroStationNames() {
  const raw = JSON.parse(fs.readFileSync(METRO_PATH, "utf8"));
  const names = new Set();
  const byNorm = new Map();
  for (const id of Object.keys(raw.stations || {})) {
    const n = raw.stations[id].stationName;
    if (!n) continue;
    names.add(n);
    const key = normalizeStationKey(n);
    if (!byNorm.has(key)) byNorm.set(key, n);
  }
  return { names, byNorm };
}

function loadDisplayMaps() {
  const raw = JSON.parse(fs.readFileSync(DISPLAY_TO_ZH_PATH, "utf8"));
  const aliasToZh = new Map();
  for (const [k, v] of Object.entries(raw.exact || {})) {
    if (v) aliasToZh.set(normalizeStationKey(k), v);
    if (v) aliasToZh.set(normalizeStationKey(v), v);
  }
  return aliasToZh;
}

function resolveToMetroName(rawName, metro) {
  const cleaned = stripHtml(rawName).split("\n")[0].trim();
  if (!cleaned) return null;
  if (STATION_ALIASES[cleaned] === null) return null;
  if (STATION_ALIASES[cleaned]) return STATION_ALIASES[cleaned];
  if (metro.names.has(cleaned)) return cleaned;
  const noSuffix = cleaned.replace(/站$/u, "");
  if (metro.names.has(noSuffix)) return noSuffix;
  const norm = normalizeStationKey(cleaned);
  if (metro.byNorm.has(norm)) return metro.byNorm.get(norm);
  return null;
}

function parseBookStations() {
  const files = fs
    .readdirSync(BOOK_TEXT_DIR)
    .filter((f) => /^part\d+\.xhtml$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const entries = new Map();
  let currentLine = "";

  for (const file of files) {
    const html = fs.readFileSync(path.join(BOOK_TEXT_DIR, file), "utf8");
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      currentLine = stripHtml(h1Match[1])
        .replace(/BEIJING SUBWAY.*/i, "")
        .replace(/北京地铁/u, "")
        .replace(/现代有轨电车/u, "西郊线")
        .replace(/磁悬浮/u, "S1")
        .trim();
    }

    const h2Re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
    let m;
    const positions = [];
    while ((m = h2Re.exec(html))) {
      positions.push({ index: m.index, inner: m[1], len: m[0].length });
    }

    for (let i = 0; i < positions.length; i += 1) {
      const { index, inner, len } = positions[i];
      const rawTitle = stripHtml(inner.split("<br")[0] || inner);
      if (!rawTitle || rawTitle.length > 24) continue;

      const end = i + 1 < positions.length ? positions[i + 1].index : html.length;
      const block = html.slice(index + len, end);
      const paras = [];
      const pRe = /<p class="bodycontent-text">([\s\S]*?)<\/p>/gi;
      let pm;
      while ((pm = pRe.exec(block))) {
        const t = stripHtml(pm[1]);
        if (t && !t.startsWith("图") && t.length > 8) paras.push(t);
      }
      if (paras.length === 0) continue;

      const prev = entries.get(rawTitle);
      if (!prev || paras.join("").length > prev.paras.join("").length) {
        entries.set(rawTitle, { rawTitle, lineLabel: currentLine, paras });
      }
    }
  }
  return entries;
}

function extractTags(text) {
  const tags = [];
  const rules = [
    [/明清|清代|明朝|民国|元代|辽|金|唐|汉/u, "朝代沿革"],
    [/皇帝|王府|格格|公主|陵|墓/u, "皇室掌故"],
    [/寺庙|寺|庵|教堂|天主/u, "宗教建筑"],
    [/胡同|老街|老字号/u, "老城脉络"],
    [/公园|园林|山|河|湖/u, "自然景观"],
    [/博物馆|纪念馆|遗址/u, "文博场馆"],
    [/大学|学院|学府/u, "校园文教"],
    [/工业|工厂|首钢|厂房/u, "工业遗存"],
    [/奥运|体育|场馆/u, "体育地标"],
    [/商业|商场|购物/u, "商业街区"],
    [/移民|村落|村/u, "聚落沿革"],
    [/铁路|火车站|枢纽/u, "交通枢纽"],
  ];
  for (const [re, tag] of rules) {
    if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 6);
}

function inferTreePath(tags, lineLabel) {
  if (tags.includes("皇室掌故") || tags.includes("宗教建筑")) return ["皇城遗韵", "古迹遗址"];
  if (tags.includes("文博场馆")) return ["博览万象", "行业专题馆"];
  if (tags.includes("校园文教")) return ["知行学府", "高等学府"];
  if (tags.includes("工业遗存")) return ["现代地标", "工业遗存"];
  if (tags.includes("体育地标")) return ["现代地标", "双奥遗产"];
  if (tags.includes("自然景观") || tags.includes("聚落沿革")) return ["老城脉络", "城市水系"];
  if (tags.includes("商业街区")) return ["潮流艺创", "国际商圈"];
  if (/S1|西郊|机场/u.test(lineLabel)) return ["现代地标", "城市交通"];
  return ["老城脉络", "地名掌故"];
}

function summarizeFromBook(paras) {
  const full = paras.join("");
  const originIdx = paras.findIndex(
    (p) =>
      /得名|由来|故称|俗称|故名|墓|葬|遗址|记载/u.test(p) &&
      !/^[^。]{0,20}位于/u.test(p)
  );
  const pick = [];
  if (originIdx >= 0) pick.push(paras[originIdx]);
  for (const p of paras) {
    if (pick.includes(p)) continue;
    if (/始建于|建于|形成于|明朝|清朝|民国|元代|永乐|乾隆|光绪/u.test(p)) {
      pick.push(p);
      if (pick.length >= 2) break;
    }
  }
  if (pick.length === 0) pick.push(paras.find((p) => !/^[^。]{0,30}位于/u.test(p)) || paras[0]);

  let summary = pick.join("").replace(/\s+/g, "");
  if (summary.length > 220) {
    const sentences = summary.split(/(?<=[。！？])/u).filter(Boolean);
    summary = "";
    for (const s of sentences) {
      if ((summary + s).length > 200) break;
      summary += s;
    }
    if (!summary) summary = pick[0].slice(0, 200);
  }
  return summary;
}

const POI_SUFFIX =
  /(?:公园|博物馆|纪念馆|寺|塔|园|大街|广场|遗址|故居|体育馆|游乐园|百货|商场|车站|火车站|机场|城墙|城门|胡同|商业街|中心|环岛|贸易中心|陵园)/u;

function extractNearbyPois(paras) {
  const pois = [];
  const text = paras.join("");
  const suffixPatterns = [
    "城乡贸易中心",
    "故宫博物院",
    "天安门广场",
    "国家博物馆",
    "军事博物馆",
    "革命军事博物馆",
    "颐和园",
    "圆明园",
    "天坛公园",
    "北海公园",
    "景山公园",
    "香山公园",
    "莲花池公园",
    "北京站",
    "北京西站",
    "北京南站",
    "首都机场",
    "琉璃厂文化街",
    "大栅栏",
    "前门大街",
    "王府井步行街",
    "三里屯",
    "国贸中心",
    "奥体公园",
    "首钢园",
    "八宝山革命公墓",
    "雍和宫",
    "白云观",
    "法源寺",
    "白云寺",
    "植物园",
  ];
  for (const name of suffixPatterns) {
    if (text.includes(name) && !pois.includes(name)) pois.push(name);
    if (pois.length >= 4) break;
  }
  if (pois.length >= 4) return pois;
  const re =
    /([\u4e00-\u9fa5]{2,8}(?:公园|博物馆|纪念馆|寺|广场|遗址|故居|游乐园|火车站|机场|城墙|城门|陵园))/gu;
  let m;
  while ((m = re.exec(text))) {
    const p = m[1].trim();
    if (/^(但|仅|若|因|而|其|此|该|这|那|在|于|为|与|及|道路|今日|当时)/u.test(p)) continue;
    if (p.length < 3 || p.length > 12) continue;
    if (!pois.includes(p)) pois.push(p);
    if (pois.length >= 4) break;
  }
  return pois;
}

function normalizeLineAffinity(lineLabel) {
  const m = lineLabel.match(/(\d+)\s*号线/u);
  if (m) return [`${m[1]}号线`];
  if (/八通/u.test(lineLabel)) return ["1号线", "八通线"];
  if (/S1|磁悬浮/u.test(lineLabel)) return ["S1线"];
  if (/西郊|有轨/u.test(lineLabel)) return ["西郊线"];
  if (/大兴机场|机场线/u.test(lineLabel)) return ["大兴机场线"];
  if (/首都机场|机场/u.test(lineLabel)) return ["首都机场线"];
  return [];
}

function buildStationRecord(canonicalName, bookEntry, existing) {
  const { paras, lineLabel } = bookEntry;
  const fullText = paras.join("");
  const culture_tags = extractTags(fullText);
  const tree_path = existing?.tree_path?.length
    ? existing.tree_path
    : inferTreePath(culture_tags, lineLabel);
  const line_affinity = [
    ...new Set([
      ...(existing?.line_affinity || []),
      ...normalizeLineAffinity(lineLabel),
    ]),
  ].filter(Boolean);

  const story_summary = summarizeFromBook(paras);
  const fromBook = extractNearbyPois(paras);
  const keptExisting = (existing?.nearby_pois || []).filter(
    (p) =>
      p &&
      p.length >= 2 &&
      p.length <= 14 &&
      !/^(但|仅|若|因|而|道路|今天|当时|仅存的)/u.test(p) &&
      !/的/u.test(p.slice(0, 2))
  );
  const nearby_pois = [...new Set([...keptExisting, ...fromBook])].slice(0, 5);

  return {
    station_name: canonicalName,
    tree_path,
    culture_tags: [...new Set([...(existing?.culture_tags || []), ...culture_tags])].slice(0, 8),
    culture_types: existing?.culture_types?.length
      ? existing.culture_types
      : [tree_path[0], tree_path[1] || "地名掌故"],
    story_summary,
    recommended_topics: existing?.recommended_topics?.length
      ? existing.recommended_topics
      : [`${canonicalName}站名由来`, "沿线历史沿革"],
    nearby_pois,
    audience_fit: existing?.audience_fit?.length
      ? existing.audience_fit
      : ["历史爱好者", "初次访京者"],
    popularity: existing?.popularity ?? 0.75,
    confidence: 0.92,
    why_recommend:
      existing?.why_recommend ||
      `《北京地铁站名掌故》载有${canonicalName}地名沿革与掌故，适合地铁沿线文化导览。`,
    line_affinity,
    book_source: "北京地铁站名掌故",
    book_excerpt: paras.slice(0, 6).join("\n\n"),
  };
}

function formatCultureContext(station, language) {
  if (!station) return "";
  if (language === "en") {
    return [
      "## Knowledge graph (ground truth — prefer these facts)",
      `Station (Chinese canonical): ${station.station_name}`,
      `Summary: ${station.story_summary}`,
      station.culture_tags?.length ? `Tags: ${station.culture_tags.join(", ")}` : "",
      station.nearby_pois?.length ? `Nearby POIs: ${station.nearby_pois.join(", ")}` : "",
      station.book_excerpt
        ? `Book excerpt (condense, do not invent beyond this):\n${station.book_excerpt.slice(0, 1200)}`
        : "",
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
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function main() {
  if (!fs.existsSync(BOOK_TEXT_DIR)) {
    console.error("Book directory not found:", BOOK_TEXT_DIR);
    process.exit(1);
  }

  const metro = loadMetroStationNames();
  const bookEntries = parseBookStations();
  const existingRaw = JSON.parse(fs.readFileSync(CULTURE_PATH, "utf8"));
  const existingList = Array.isArray(existingRaw.stations) ? existingRaw.stations : [];
  const existingByName = new Map();
  for (const s of existingList) {
    const n = s.station_name;
    if (!n) continue;
    if (!existingByName.has(n)) existingByName.set(n, s);
  }

  const matched = [];
  const unmatchedBook = [];
  const updated = new Map(existingByName);

  for (const [rawTitle, bookEntry] of bookEntries) {
    const canonical = resolveToMetroName(rawTitle, metro);
    if (!canonical) {
      unmatchedBook.push(rawTitle);
      continue;
    }
    matched.push(canonical);
    const prev = updated.get(canonical);
    updated.set(canonical, buildStationRecord(canonical, bookEntry, prev));
  }

  const stations = Array.from(updated.values()).sort((a, b) =>
    a.station_name.localeCompare(b.station_name, "zh-Hans-CN")
  );

  const names = stations.map((s) => s.station_name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) {
    console.error("Duplicate station names remain:", [...new Set(dup)]);
    process.exit(1);
  }

  fs.writeFileSync(CULTURE_PATH, JSON.stringify({ stations }, null, 2) + "\n", "utf8");

  console.log("Book entries parsed:", bookEntries.size);
  console.log("Matched to metro:", matched.length, "unique:", new Set(matched).size);
  console.log("Unmatched book titles (sample):", unmatchedBook.slice(0, 25).join(", "));
  console.log("Output stations:", stations.length);
  console.log("Duplicates:", dup.length);

}

main();

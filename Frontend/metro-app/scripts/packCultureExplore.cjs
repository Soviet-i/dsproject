/**
 * Builds src/data/cultureExploreEn.json from:
 * - ../../Backend/data/stationCultureTree.json (source + validation)
 * - ./cultureExploreLabels.tsv  (zh<TAB>en per line)
 * - ./cultureExploreStories.tsv (station_name<TAB>story_zh<TAB>story_en)
 *
 * Run from metro-app: node scripts/packCultureExplore.cjs
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const treePath = path.join(root, "..", "..", "Backend", "data", "stationCultureTree.json");
const outPath = path.join(root, "src", "data", "cultureExploreEn.json");
const labelTsvPath = path.join(__dirname, "cultureExploreLabels.tsv");
const storyTsvPath = path.join(__dirname, "cultureExploreStories.tsv");

function readLines(p) {
  return fs
    .readFileSync(p, "utf8")
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+$/, ""))
    .filter((line, i, arr) => !(line === "" && i === arr.length - 1));
}

function collectCultureZhLabels(stations) {
  const set = new Set();
  for (const s of stations) {
    for (const t of s.culture_tags || []) {
      const x = String(t || "").trim();
      if (x) set.add(x);
    }
    for (const t of s.culture_types || []) {
      const x = String(t || "").trim();
      if (x) set.add(x);
    }
    for (const t of s.tree_path || []) {
      const x = String(t || "").trim();
      if (x) set.add(x);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function readLabelTsv(p) {
  const labels = {};
  for (const line of readLines(p)) {
    const i = line.indexOf("\t");
    if (i < 0) continue;
    labels[line.slice(0, i)] = line.slice(i + 1);
  }
  return labels;
}

function readStoryTsv(p) {
  const storyEnByKey = {};
  const storyEnByStation = {};
  for (const line of readLines(p)) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const stationName = parts[0];
    const storyEn = parts[parts.length - 1];
    const storyZh = parts.slice(1, -1).join("\t");
    storyEnByKey[`${stationName}\t${storyZh}`] = storyEn;
    storyEnByStation[stationName] = storyEn;
  }
  return { storyEnByKey, storyEnByStation };
}

const tree = JSON.parse(fs.readFileSync(treePath, "utf8"));
const labels = readLabelTsv(labelTsvPath);
const { storyEnByKey, storyEnByStation } = readStoryTsv(storyTsvPath);

const payload = {
  version: 2,
  labels,
  reasonLabels: {
    同属主题: "Shared theme",
    共享标签: "Shared tags",
    同类属性: "Similar attributes",
  },
  storyEnByKey,
  storyEnByStation,
};

fs.writeFileSync(outPath, JSON.stringify(payload));
console.log(
  "Wrote",
  outPath,
  "labels",
  Object.keys(labels).length,
  "storyEnByStation",
  Object.keys(storyEnByStation).length
);

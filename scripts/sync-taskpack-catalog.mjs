import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const officialRoot = path.join(repoRoot, "examples", "taskpacks", "official");
const require = createRequire(path.join(repoRoot, "packages", "taskpacks", "package.json"));
const { parse } = require("yaml");
const checkOnly = process.argv.includes("--check");
const start = "<!-- official-taskpacks:start -->";
const end = "<!-- official-taskpacks:end -->";
const zhLibraryHeading = "\u5b98\u65b9\u4efb\u52a1\u5305\u5e93";
const zhDocsHeading = "\u6587\u6863";

const files = (await fs.readdir(officialRoot)).filter((name) => /\.ya?ml$/i.test(name)).sort();
const packs = await Promise.all(files.map(async (name) => {
  const raw = await fs.readFile(path.join(officialRoot, name), "utf8");
  const value = parse(raw);
  return { name, ...value };
}));
const corePacks = packs.filter((pack) => pack.metadata?.lifecycle === "core");
const legacyPacks = packs.filter((pack) => pack.metadata?.lifecycle !== "core");
if (corePacks.length === 0) {
  throw new Error("No lifecycle: core task packs were found; refusing to generate an empty first-release catalog.");
}

function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}
function block(locale) {
  const isZh = locale === "zh-CN";
  const lines = [
    start,
    "",
    isZh
      ? `\u9996\u53d1\u6bd4\u8f83\u76ee\u5f55\u5305\u542b **${corePacks.length}** \u4e2a\u6838\u5fc3\u4efb\u52a1\u5305\uff1b\u53e6\u6709 **${legacyPacks.length}** \u4e2a\u5386\u53f2/\u5b9e\u9a8c\u4efb\u52a1\u5305\u4fdd\u7559\u5728\u4ed3\u5e93\u4e2d\uff0c\u4f46\u4e0d\u8fdb\u5165\u9996\u53d1\u6bd4\u8f83\u3002`
      : `The first-release comparison catalog contains **${corePacks.length}** core task packs. ${legacyPacks.length} historical/experimental packs remain in the repository but are excluded from first-release comparison.`,
    "",
    isZh ? "| \u4efb\u52a1\u5305 | \u540d\u79f0 | \u7528\u9014 |" : "| Task pack | Name | Purpose |",
    "| --- | --- | --- |"
  ];
  for (const pack of corePacks) {
    const translated = pack.metadata?.i18n?.[locale] ?? {};
    lines.push(`| \`${cell(pack.id)}\` | ${cell(translated.title ?? pack.title)} | ${cell(translated.description ?? pack.description)} |`);
  }
  lines.push("", end);
  return lines.join("\n");
}

function legacyBlock(locale) {
  const isZh = locale === "zh-CN";
  const heading = isZh ? "## \u4fdd\u7559\u4f46\u6682\u4e0d\u7eb3\u5165\u9996\u53d1\u6bd4\u8f83\u7684\u4efb\u52a1\u5305" : "## Retained legacy and experimental packs";
  const intro = isZh
    ? "\u4ee5\u4e0b\u4efb\u52a1\u5305\u6ca1\u6709\u5220\u9664\uff0c\u4f46\u5c1a\u672a\u5b8c\u6210\u9996\u53d1\u5939\u5177\u548c\u8fb9\u754c\u6821\u51c6\uff1b\u53ef\u624b\u52a8\u8fd0\u884c\uff0c\u4e0d\u4f1a\u51fa\u73b0\u5728\u9996\u53d1\u6bd4\u8f83\u5217\u8868\u3002"
    : "These files are retained for manual use, but their fixtures or boundaries are not yet calibrated for first-release comparison.";
  return [heading, "", intro, "", legacyPacks.map((pack) => `- \`${cell(pack.id)}\``).join("\n")].join("\n");
}

async function updateFile(filePath, contentFactory, bootstrap) {
  let source = await fs.readFile(filePath, "utf8");
  if (!source.includes(start) || !source.includes(end)) source = bootstrap(source);
  const next = source.replace(new RegExp(`${start}[\\s\\S]*?${end}`), contentFactory());
  if (checkOnly) {
    if (next !== source) throw new Error(`${path.relative(repoRoot, filePath)} task pack catalog is stale. Run pnpm taskpacks:sync.`);
    return;
  }
  await fs.writeFile(filePath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
}

await updateFile(
  path.join(repoRoot, "README.md"),
  () => block("en"),
  (source) => source.replace(/## Official Task Pack Library[\s\S]*?(?=\n## Repository Layout)/, `## Official Task Pack Library\n\n${start}\n${end}\n`)
);
await updateFile(
  path.join(repoRoot, "README.zh-CN.md"),
  () => block("zh-CN"),
  (source) => source.replace(new RegExp(`## ${zhLibraryHeading}[\\s\\S]*?(?=\\n## ${zhDocsHeading})`), `## ${zhLibraryHeading}\n\n${start}\n${end}\n`)
);

const officialReadme = path.join(officialRoot, "README.md");
const officialBody = [
  "# Official Task Packs | \u5b98\u65b9\u4efb\u52a1\u5305",
  "",
  "This directory contains the first-party task pack library maintained by AgentArena.",
  "",
  block("en"),
  "",
  "## \u4e2d\u6587\u76ee\u5f55",
  "",
  block("zh-CN").replace(start, "<!-- official-taskpacks-zh:start -->").replace(end, "<!-- official-taskpacks-zh:end -->"),
  "",
  legacyBlock("en"),
  "",
  "## Usage | \u4f7f\u7528\u65b9\u5f0f",
  "",
  "Choose a task pack in Workbench, or pass its path to `agentarena run --task <path>`.",
  ""
].join("\n");
if (checkOnly) {
  const current = await fs.readFile(officialReadme, "utf8");
  if (current !== officialBody) throw new Error("examples/taskpacks/official/README.md task pack catalog is stale. Run pnpm taskpacks:sync.");
} else {
  await fs.writeFile(officialReadme, officialBody, "utf8");
  console.log(`Synchronized ${corePacks.length} core task packs (${legacyPacks.length} legacy retained) across README catalogs.`);
}

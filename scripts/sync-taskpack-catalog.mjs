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

function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}
function block(locale) {
  const isZh = locale === "zh-CN";
  const lines = [
    start,
    "",
    isZh
      ? `\u5f53\u524d\u5171\u6709 **${packs.length}** \u4e2a\u5b98\u65b9\u4efb\u52a1\u5305\u3002\u4ee5\u4e0b\u76ee\u5f55\u76f4\u63a5\u7531\u4efb\u52a1\u5305\u6587\u4ef6\u751f\u6210\u3002`
      : `There are **${packs.length}** official task packs. This catalog is generated directly from the task pack files.`,
    "",
    isZh ? "| \u4efb\u52a1\u5305 | \u540d\u79f0 | \u7528\u9014 |" : "| Task pack | Name | Purpose |",
    "| --- | --- | --- |"
  ];
  for (const pack of packs) {
    const translated = pack.metadata?.i18n?.[locale] ?? {};
    lines.push(`| \`${cell(pack.id)}\` | ${cell(translated.title ?? pack.title)} | ${cell(translated.description ?? pack.description)} |`);
  }
  lines.push("", end);
  return lines.join("\n");
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
  console.log(`Synchronized ${packs.length} official task packs across README catalogs.`);
}

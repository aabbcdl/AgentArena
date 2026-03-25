export function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function downloadTextFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function folderOf(file) {
  const relativePath = file.webkitRelativePath || file.name;
  const segments = relativePath.split("/");
  segments.pop();
  return segments.join("/");
}

export async function readRunFromFile(file, { localText }) {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(
      localText(
        `无法解析文件 "${file.name}"，请确认这是有效的 summary.json。`,
        `Failed to parse "${file.name}". Make sure it is a valid summary.json file.`
      )
    );
  }
}

export function createResultLoaders({ state, localText, render, renderMarkdownPanel, applySingleRun, applyRuns }) {
  async function handleFileSelection(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const run = await readRunFromFile(file, { localText });
      state.notice =
        state.language === "zh-CN"
          ? "已加载单个 summary.json。现在可以直接查看结果，或者继续加载 summary.md。"
          : "Loaded one summary.json file. You can inspect the run now or optionally load summary.md.";
      applySingleRun(run);
    } catch (error) {
      state.notice = error instanceof Error ? error.message : String(error);
      render();
    }
  }

  async function handleMarkdownSelection(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      state.standaloneMarkdown = await file.text();
      state.notice =
        state.language === "zh-CN"
          ? "Markdown 已加载。如果当前也有 run，分享摘要会自动出现。"
          : "Markdown loaded. If a run is also loaded, the share summary will appear automatically.";
      renderMarkdownPanel();
    } catch (error) {
      state.notice = error instanceof Error ? error.message : String(error);
      render();
    }
  }

  async function handleFolderSelection(event) {
    const files = Array.from(event.target.files ?? []);
    const summaryFiles = files.filter((file) => file.name.toLowerCase() === "summary.json");
    if (summaryFiles.length === 0) {
      state.notice =
        state.language === "zh-CN"
          ? "所选目录里没有 summary.json。请选择一个 RepoArena 结果目录。"
          : "No summary.json file was found in the selected folder. Choose a RepoArena results folder.";
      return;
    }

    const markdownByFolder = new Map();
    for (const file of files.filter((entry) => entry.name.toLowerCase() === "summary.md")) {
      markdownByFolder.set(folderOf(file), await file.text());
    }

    const runs = [];
    const markdownByRunId = new Map();
    for (const file of summaryFiles) {
      try {
        const run = await readRunFromFile(file, { localText });
        runs.push(run);
        const markdown = markdownByFolder.get(folderOf(file));
        if (markdown) {
          markdownByRunId.set(run.runId, markdown);
        }
      } catch (error) {
        console.warn(`Skipping invalid summary file: ${file.name}`, error);
      }
    }

    state.notice =
      state.language === "zh-CN"
        ? `已从所选目录中识别到 ${runs.length} 个 run。`
        : `Loaded ${runs.length} run(s) from the selected folder.`;
    applyRuns(runs, markdownByRunId);
  }

  return {
    handleFileSelection,
    handleMarkdownSelection,
    handleFolderSelection
  };
}

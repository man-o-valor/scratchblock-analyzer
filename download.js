const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

/*
Usage: node . <id>/<start-end> [count]
If a range is provided and [count] is present and smaller than the range length,
a random subset of that many IDs will be scraped.
*/

if (!process.argv[2]) {
  console.log("\x1b[0m");
  console.log("Usage:");
  console.log("");
  console.log("node . <id>");
  console.log("\x1b[90mDownloads the project.json of one project by its ID");
  console.log("node . 1305979714\x1b[0m");
  console.log("");
  console.log("node . <id>-<id>");
  console.log("\x1b[90mDownloads the project.json of all projects in a range");
  console.log("node . 1-1000\x1b[0m");
  console.log("");
  console.log("node . <id>-<id> [count]");
  console.log(
    "\x1b[90mDownloads the project.json of [count] random projects in a range",
  );
  console.log("node . 1-1305979715 1000\x1b[0m");
  console.log("");
  console.log("node . regen");
  console.log("node . regenerate");
  console.log("\x1b[90mRegenerates block_stats.json and block counts jsons from project.json files in the projects/ directory");
  console.log("node . regen\x1b[0m");
  console.log("");
  process.exit(1);
}

if (process.argv[2] === "regenerate" || process.argv[2] === "regen") {
  const projectsDir = path.join(__dirname, "projects");
  if (!fs.existsSync(projectsDir)) {
    console.log(
      "\x1b[91m[!] projects/ directory does not exist. Nothing to regenerate.\x1b[0m",
    );
    process.exit(1);
  }
  const files = fs
    .readdirSync(projectsDir)
    .filter((f) => /^project\d+\.json$/.test(f));
  if (files.length === 0) {
    console.log(
      "\x1b[91m[!] No project.json files found in projects/. Nothing to regenerate.\x1b[0m",
    );
    process.exit(0);
  }

  let unavailableCount = 0;
  try {
    const statsPath = path.join(__dirname, "block_stats.json");
    if (fs.existsSync(statsPath)) {
      const existingStats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
      unavailableCount = existingStats.summary.unavailableCount || 0;
    }
  } catch (err) {
    // ignore
  }

  const opcodeStats = {};
  let processed = 0;
  for (const file of files) {
    const idMatch = file.match(/^project(\d+)\.json$/);
    if (!idMatch) continue;
    const id = idMatch[1];
    try {
      const text = fs.readFileSync(path.join(projectsDir, file), "utf8");
      const projectJson = JSON.parse(text);
      const opcodeCounts = {};
      for (const target of projectJson.targets || []) {
        const blocks = target.blocks || {};
        for (const blkId in blocks) {
          const blk = blocks[blkId];
          if (!blk || !blk.opcode) continue;
          opcodeCounts[blk.opcode] = (opcodeCounts[blk.opcode] || 0) + 1;
        }
      }
      opcodeStats[id] = {
        opcodes: opcodeCounts,
        shareDate: projectJson.shareDate,
      };
    } catch (err) {
      console.log(`\x1b[91m[!] Failed to read/parse ${file}: ${err}\x1b[0m`);
    }
    processed++;
    process.stdout.write(`\rRegenerated ${processed}/${files.length}`);
  }
  process.stdout.write("\n");

  computeAndWriteStats(
    opcodeStats,
    files.length + unavailableCount,
    projectsDir,
    unavailableCount,
  )
    .then(() => process.exit(0))
    .catch((err) => {
      console.log(`\x1b[91m[!] Error generating stats:\x1b[0m${err}`);
      process.exit(1);
    });
  return;
}

function parseRange(arg, maxExpand = 1000000) {
  if (arg.includes("-")) {
    const parts = arg.split("-").map((s) => s.trim());
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
      throw new Error("Invalid range");
    }
    const length = end - start + 1;
    if (length <= 0) throw new Error("Invalid range length");
    if (length <= maxExpand) {
      const out = [];
      for (let i = start; i <= end; i++) out.push(i);
      return { type: "array", ids: out };
    }
    return { type: "range", start, end, length };
  }
  const n = Number(arg);
  if (Number.isNaN(n)) throw new Error("Invalid id");
  return { type: "array", ids: [n] };
}

const parsed = parseRange(process.argv[2]);
let ids = [];
if (parsed.type === "array") ids = parsed.ids;

let selectedIds = ids;
if (process.argv[3]) {
  const count = Number(process.argv[3]);
  if (Number.isNaN(count) || count <= 0) {
    console.log(
      "\x1b[91m[!] Invalid count specified. Count must be a positive integer.\x1b[0m",
    );
    process.exit(1);
  }

  if (parsed.type === "array") {
    if (ids.length > count) {
      const shuffled = ids.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selectedIds = shuffled.slice(0, count);
      console.log(
        `\x1b[96m[+] Range contains ${ids.length} ids — randomly selected ${selectedIds.length} ids to scrape\x1b[0m`,
      );
    } else {
      console.log(
        `\x1b[96m[+] Range contains ${ids.length} ids — scraping all of them\x1b[0m`,
      );
    }
  } else if (parsed.type === "range") {
    if (count >= parsed.length) {
      console.log(
        "\x1b[91m[!] Requested count is >= range size and range is too large to expand. Please specify a smaller count or narrower range.\x1b[0m",
      );
      process.exit(1);
    }
    const picked = new Set();
    while (picked.size < count) {
      const randOffset = Math.floor(Math.random() * parsed.length);
      const val = parsed.start + randOffset;
      picked.add(val);
    }
    selectedIds = Array.from(picked);
    console.log(
      `[+] Range contains ${parsed.length} ids — randomly selected ${selectedIds.length} ids to scrape`,
    );
  }
}

if (!selectedIds.length && parsed.type === "range") {
  console.log(
    "\x1b[91m[!] Range is too large to expand. Provide a count as the third argument to sample IDs.\x1b[0m",
  );
  process.exit(1);
}

function renderProgress(completed, total) {
  const pct = total === 0 ? 0 : completed / total;
  const percent = Math.round(pct * 100);
  console.log(
    `\x1b[90m[.] Progress: ${percent}% (${completed}/${total})\x1b[0m`,
  );
}

let totalOps = 0;
let completedOps = 0;

(async () => {
  const projectsDir = path.join(__dirname, "projects");
  try {
    fs.mkdirSync(projectsDir, { recursive: true });
  } catch (err) {
    console.log(
      `\x1b[91m[!] Failed to create projects directory: \x1b[0m${err}`,
    );
    process.exit(1);
  }

  const opcodeStats = {};
  let unavailableCount = 0;

  totalOps = selectedIds.length;
  completedOps = 0;
  renderProgress(completedOps, totalOps);

  for (const ID of selectedIds) {
    const OUTPUT_FILE = `project${ID}.json`;
    const filePath = path.join(projectsDir, OUTPUT_FILE);

    if (fs.existsSync(filePath)) {
      console.log(
        `\x1b[91m[!] File with same name already exists: ./projects/${OUTPUT_FILE} — skipping`,
      );
      unavailableCount++;
      completedOps++;
      renderProgress(completedOps, totalOps);
      continue;
    }

    console.log(`\x1b[90m[.] Trying project ${ID}\x1b[0m`);

    try {
      const projectInfoResp = await fetch(
        `https://api.scratch.mit.edu/projects/${ID}`,
      );
      if (!projectInfoResp.ok) {
        console.log(
          `\x1b[93m[-] Project ${ID} unavailable (HTTP ${projectInfoResp.status}) - skipping\x1b[0m`,
        );
        unavailableCount++;
        completedOps++;
        renderProgress(completedOps, totalOps);
        continue;
      }

      const projectInfoJson = await projectInfoResp.json();

      if (!projectInfoJson) {
        console.log(
          `\x1b[93m[-] Project ${ID} returned no information. Skipping.\x1b[0m`,
        );
        unavailableCount++;
        completedOps++;
        renderProgress(completedOps, totalOps);
        continue;
      } else if (projectInfoJson.code) {
        console.log(
          `\x1b[93m[-] Project ${ID} returned error code ${projectInfoJson.code}. Skipping.\x1b[0m`,
        );
        unavailableCount++;
        completedOps++;
        renderProgress(completedOps, totalOps);
        continue;
      }

      console.log(`\x1b[92m[+] Found project ${ID}\x1b[0m`);

      const projectToken = projectInfoJson.project_token;

      const projectJsonResponse = await fetch(
        `https://projects.scratch.mit.edu/${ID}${projectToken ? `?token=${projectToken}` : ""}`,
      );

      let projectJson;
      try {
        const text = await projectJsonResponse.text();
        projectJson = JSON.parse(text);
      } catch (error) {
        console.log(
          `\x1b[93m[!] Failed to parse project.json for ${ID}, possibly legacy or malformed - skipping\x1b[0m`,
        );
        unavailableCount++;
        completedOps++;
        renderProgress(completedOps, totalOps);
        continue;
      }

      if (!projectJson) {
        console.log(
          `\x1b[93m[!] project.json not present for ${ID}. Skipping.\x1b[0m`,
        );
        unavailableCount++;
        completedOps++;
        renderProgress(completedOps, totalOps);
        continue;
      }

      projectJson.createdDate = projectInfoJson.history.created;
      projectJson.shareDate = projectInfoJson.history.shared;
      projectJson.commentsAllowed = projectInfoJson.comments_allowed;
      projectJson.authorJoinDate = projectInfoJson.author.history.joined;
      projectJson.stats = projectInfoJson.stats;
      projectJson.remixParents = projectInfoJson.remix;

      const opcodeCounts = {};
      for (const target of projectJson.targets || []) {
        const blocks = target.blocks || {};
        for (const blkId in blocks) {
          const blk = blocks[blkId];
          if (!blk || !blk.opcode) continue;
          opcodeCounts[blk.opcode] = (opcodeCounts[blk.opcode] || 0) + 1;
        }
      }
      opcodeStats[ID] = {
        opcodes: opcodeCounts,
        shareDate: projectJson.shareDate,
      };

      fs.writeFileSync(filePath, JSON.stringify(projectJson, null, 2), "utf8");
      console.log(
        `\x1b[92m[+] Wrote project.json to ./projects/${OUTPUT_FILE}\x1b[0m`,
      );
    } catch (error) {
      console.log(
        `\x1b[91m[!] Encountered error processing project ${ID}: ${error}\x1b[0m`,
      );
      unavailableCount++;
      completedOps++;
      renderProgress(completedOps, totalOps);
      continue;
    }

    // success
    completedOps++;
    renderProgress(completedOps, totalOps);
  }

  await computeAndWriteStats(
    opcodeStats,
    selectedIds.length,
    projectsDir,
    unavailableCount,
  );
})();

async function computeAndWriteStats(
  opcodeStats,
  expectedRequested,
  projectsDir,
  unavailableCount = 0,
) {
  const totals = {};
  const opcodeProjectPresence = {};
  let projectCount = 0;
  let blocksPerProjectSum = 0;

  for (const pid in opcodeStats) {
    projectCount++;
    const map = opcodeStats[pid].opcodes || {};
    let projectBlockSum = 0;
    for (const op in map) {
      const c = map[op] || 0;
      totals[op] = (totals[op] || 0) + c;
      opcodeProjectPresence[op] = (opcodeProjectPresence[op] || 0) + 1;
      projectBlockSum += c;
    }
    blocksPerProjectSum += projectBlockSum;
  }

  const totalBlocks = Object.values(totals).reduce((a, b) => a + b, 0);
  const distinctOpcodes = Object.keys(totals).length;
  const averageBlocksPerProject =
    projectCount === 0 ? 0 : Math.round(blocksPerProjectSum / projectCount);
  const accessiblePercent =
    expectedRequested && expectedRequested > 0
      ? Math.round((projectCount / expectedRequested) * 10000) / 100
      : 100;

  const totalsSorted = Object.keys(totals)
    .map((op) => ({ opcode: op, count: totals[op] }))
    .sort((a, b) => a.count - b.count);

  const presenceSorted = Object.keys(opcodeProjectPresence)
    .map((op) => ({ opcode: op, projects: opcodeProjectPresence[op] }))
    .sort((a, b) => a.projects - b.projects);

  // Sanitize block counts by filtering to allowed opcodes
  let allowedOpcodes = new Set();
  let filterEnabled = false;
  const allowedJsPath = path.join(__dirname, "allowed_blocks.js");

  if (fs.existsSync(allowedJsPath)) {
    try {
      const allowedModule = await import(pathToFileURL(allowedJsPath).href);
      let allowed = Array.isArray(allowedModule)
        ? allowedModule
        : allowedModule.default ?? allowedModule.allowedBlocks ?? allowedModule;
      if (!Array.isArray(allowed) && allowedModule.allowedBlocks) {
        allowed = allowedModule.allowedBlocks;
      }
      if (Array.isArray(allowed)) {
        allowedOpcodes = new Set(allowed);
        filterEnabled = true;
      } else {
        console.log(
          `\x1b[93m[!] allowed_blocks.js found but does not export an array. Sanitization disabled.\x1b[0m`,
        );
      }
    } catch (err) {
      console.log(
        `\x1b[91m[!] Failed to import allowed_blocks.js: \x1b[0m${err}`,
      );
    }
  } else {
    console.log(
      `\x1b[93m[!] allowed_blocks.js not found. Block count sanitization disabled.\x1b[0m`,
    );
  }

  let sanitizedTotalsSorted = totalsSorted;
  let sanitizedPresenceSorted = presenceSorted;
  if (filterEnabled && allowedOpcodes.size > 0) {
    sanitizedTotalsSorted = totalsSorted.filter((item) =>
      allowedOpcodes.has(item.opcode),
    );
    sanitizedPresenceSorted = presenceSorted.filter((item) =>
      allowedOpcodes.has(item.opcode),
    );
  } else if (!filterEnabled) {
    sanitizedTotalsSorted = [];
    sanitizedPresenceSorted = [];
  }

  const summary = {
    requestedCount: expectedRequested || 0,
    projectCount,
    unavailableCount,
    accessiblePercent,
    totalBlocks,
    averageBlocksPerProject,
    distinctOpcodes,
  };

  const finalStats = { totals, summary, totalsSorted, presenceSorted };
  for (const pid of Object.keys(opcodeStats))
    finalStats[pid] = opcodeStats[pid];

  try {
    const statsPath = path.join(__dirname, "block_stats.json");
    fs.writeFileSync(statsPath, JSON.stringify(finalStats, null, 2), "utf8");
    console.log(
      `\x1b[96m[+] Wrote stats to block_stats.json\x1b[0m`,
    );
  } catch (err) {
    console.log(`\x1b[91m[!] Failed to write stats: \x1b[0m${err}`);
  }

  const blockCountsTotalPath = path.join(__dirname, "block_counts.json");
  try {
    fs.writeFileSync(
      blockCountsTotalPath,
      JSON.stringify(sanitizedTotalsSorted, null, 2),
      "utf8",
    );
    console.log(
      `\x1b[96m[+] Wrote block counts total to block_counts.json\x1b[0m`,
    );
  } catch (err) {
    console.log(
      `\x1b[91m[!] Failed to write block counts total: \x1b[0m${err}`,
    );
  }

  const blockCountsPresencePath = path.join(
    __dirname,
    "block_counts_presence.json",
  );
  try {
    fs.writeFileSync(
      blockCountsPresencePath,
      JSON.stringify(sanitizedPresenceSorted, null, 2),
      "utf8",
    );
    console.log(
      `\x1b[96m[+] Wrote block counts presence to block_counts_presence.json\x1b[0m`,
    );
  } catch (err) {
    console.log(
      `\x1b[91m[!] Failed to write block counts presence: \x1b[0m${err}`,
    );
  }
}

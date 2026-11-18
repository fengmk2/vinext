import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { stripVTControlCharacters } from "node:util";

const [beforePath, afterPath, outputPath] = process.argv.slice(2);
if (!beforePath || !afterPath || !outputPath) {
  throw new Error("Usage: node benchmark-vp-check.mjs <before> <after> <output>");
}

const outputDir = path.resolve(outputPath);
mkdirSync(outputDir, { recursive: true });
const env = { ...process.env, NO_COLOR: "1" };
const variants = [
  { name: "before", cwd: path.resolve(beforePath) },
  { name: "after", cwd: path.resolve(afterPath) },
];
const results = {
  command: "vp check",
  startedAt: new Date().toISOString(),
  baseSha: process.env.BASE_SHA,
  sourceSha: process.env.HEAD_SHA,
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length,
  memoryBytes: os.totalmem(),
  warmupsPerVersion: 1,
  measuredRunsPerVersion: 7,
  variants,
  runs: [],
  valid: false,
};

function saveResults() {
  writeFileSync(path.join(outputDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
}

function runCheck(variant, round, warmup) {
  const start = performance.now();
  const child = spawnSync("vp", ["check"], {
    cwd: variant.cwd,
    env,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const seconds = (performance.now() - start) / 1000;
  const output = (child.stdout ?? "") + (child.stderr ?? "");
  const plainOutput = stripVTControlCharacters(output);
  const formatCount = plainOutput.match(/All (\d+) files are correctly formatted/);
  const lintCount = plainOutput.match(
    /Found no warnings, lint errors, or type errors in (\d+) files/,
  );
  const run = {
    variant: variant.name,
    round,
    warmup,
    seconds,
    status: child.status,
    signal: child.signal,
    error: child.error?.message,
    formattedFiles: formatCount ? Number(formatCount[1]) : null,
    lintedFiles: lintCount ? Number(lintCount[1]) : null,
    output,
  };
  results.runs.push(run);
  writeFileSync(path.join(outputDir, `${variant.name}-${warmup ? "warmup" : round}.log`), output);
  saveResults();
  console.log(
    `${variant.name} ${warmup ? "warmup" : `run ${round}`}: ${seconds.toFixed(3)}s, exit ${child.status}`,
  );

  if (child.status !== 0 || !run.formattedFiles || !run.lintedFiles) {
    console.error(output);
    throw new Error(`${variant.name} did not complete all vp check phases successfully`);
  }
  const first = results.runs[0];
  if (run.formattedFiles !== first.formattedFiles || run.lintedFiles !== first.lintedFiles) {
    throw new Error("The versions checked different file counts; the timings are not comparable");
  }
}

let summary = "## Vite+ check comparison\n\n";
try {
  for (const variant of variants) {
    variant.version = JSON.parse(
      readFileSync(path.join(variant.cwd, "node_modules/vite-plus/package.json"), "utf8"),
    ).version;
    const version = spawnSync("vp", ["--version"], {
      cwd: variant.cwd,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    variant.toolchain = (version.stdout ?? "") + (version.stderr ?? "");
    if (version.status !== 0) throw new Error(`Cannot inspect ${variant.name} toolchain`);
  }
  if (variants[0].version === variants[1].version) {
    throw new Error("The before and after installations use the same Vite+ version");
  }

  for (const variant of variants) runCheck(variant, 0, true);
  for (let round = 1; round <= results.measuredRunsPerVersion; round++) {
    const order = round % 2 === 1 ? variants : [...variants].reverse();
    for (const variant of order) runCheck(variant, round, false);
  }

  for (const variant of variants) {
    const times = results.runs
      .filter((run) => run.variant === variant.name && !run.warmup)
      .map((run) => run.seconds)
      .sort((a, b) => a - b);
    variant.medianSeconds = times[Math.floor(times.length / 2)];
    variant.minSeconds = times[0];
    variant.maxSeconds = times.at(-1);
  }
  const [before, after] = variants;
  results.valid = true;
  results.speedup = before.medianSeconds / after.medianSeconds;
  results.timeReductionPercent = (1 - after.medianSeconds / before.medianSeconds) * 100;
  summary +=
    "Both versions checked the same source on the same machine with one shared Node.js version and Vite+ launcher.\n\n" +
    "One warmup per version, followed by seven measured runs per version in alternating order. " +
    "Times include the full `vp check` process; installation and builds are excluded.\n\n" +
    "| Version | Median | Minimum | Maximum |\n| --- | ---: | ---: | ---: |\n";
  for (const variant of variants) {
    summary += `| ${variant.name}: ${variant.version} | ${variant.medianSeconds.toFixed(3)} s | ${variant.minSeconds.toFixed(3)} s | ${variant.maxSeconds.toFixed(3)} s |\n`;
  }
  summary += `\nBefore/after median ratio: **${results.speedup.toFixed(2)}×**. After uses **${results.timeReductionPercent.toFixed(1)}% less time** (negative means slower).\n\n`;
  summary += `All runs passed: ${results.runs[0].formattedFiles} formatted files and ${results.runs[0].lintedFiles} linted/type-checked files per run.\n\n`;
  summary += `Node.js: \`${results.node}\`. CPU: ${results.cpu}; ${results.logicalCpus} logical cores.\n`;
} catch (error) {
  results.error = error instanceof Error ? error.message : String(error);
  summary += `The comparison is incomplete: ${results.error}. See the uploaded logs.\n`;
  console.error(results.error);
  process.exitCode = 1;
} finally {
  saveResults();
  writeFileSync(path.join(outputDir, "summary.md"), summary);
  console.log(summary);
}

/**
 * Run the Distill pipeline against a bundled dataset and write a RunFile.
 *
 *   pnpm pipeline --dataset fitness --out data/runs/fitness.json \
 *     [--limit 200] [--depth fast|thorough] [--product "…"] [--decision "…"] [--concurrency 4]
 *
 * Log lines stream to stderr; the RunFile is written to --out. Exits 1 on a
 * typed pipeline error, 2 on bad usage.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Depth, PipelineEvent, RunContext } from "../src/lib/types";
import { AnthropicLLM } from "../src/pipeline/client";
import { MissingApiKeyError, PipelineError } from "../src/pipeline/errors";
import { loadDataset } from "../src/pipeline/ingest";
import { resolveModels } from "../src/pipeline/models";
import { runPipeline } from "../src/pipeline/run";

const USAGE = `usage: pnpm pipeline --dataset <id> --out <file.json> [--limit N] [--depth fast|thorough] [--product "…"] [--decision "…"] [--concurrency N]`;

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string" },
      out: { type: "string" },
      limit: { type: "string" },
      depth: { type: "string", default: "thorough" },
      product: { type: "string" },
      decision: { type: "string" },
      concurrency: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!values.dataset) fail(`missing --dataset\n${USAGE}`, 2);
  const out = values.out ?? `data/runs/${values.dataset}.json`;
  const depth = values.depth as Depth;
  if (depth !== "fast" && depth !== "thorough") fail(`--depth must be fast or thorough\n${USAGE}`, 2);
  const limit = values.limit !== undefined ? Number(values.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) fail(`--limit must be a positive integer`, 2);
  const concurrency = values.concurrency !== undefined ? Number(values.concurrency) : undefined;
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency <= 0)) fail(`--concurrency must be a positive integer`, 2);

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new MissingApiKeyError();
  }

  const dataset = await loadDataset(values.dataset);
  const context: RunContext = {
    product: values.product ?? dataset.meta.defaultContext.product,
    ...(values.decision !== undefined
      ? { decision: values.decision }
      : dataset.meta.defaultContext.decision
        ? { decision: dataset.meta.defaultContext.decision }
        : {}),
  };
  const cap = limit ?? dataset.items.length;
  const models = resolveModels(depth);
  process.stderr.write(`distill · dataset ${dataset.meta.id} · ${dataset.items.length} items · cap ${cap} · depth ${depth} · extract ${models.extract} · synth ${models.synth}\n`);

  const llm = new AnthropicLLM({ logger: { warn: (m) => process.stderr.write(`  ! ${m}\n`) } });
  const onEvent = (e: PipelineEvent): void => {
    const t = e.t.toFixed(1).padStart(6);
    if (e.type === "log") process.stderr.write(`${t}  ${e.message}\n`);
    else if (e.type === "stage") process.stderr.write(`${t}  [${e.stage} ${e.status}]${e.note ? ` ${e.note}` : ""}\n`);
    else if (e.type === "error") process.stderr.write(`${t}  ERROR ${e.message}\n`);
  };

  const file = await runPipeline({
    datasetId: values.dataset,
    context,
    settings: { depth, cap },
    llm,
    onEvent,
    concurrency,
  });

  const outPath = resolve(out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  process.stderr.write(
    `wrote ${outPath} · ${file.events.length} events · ${file.run.stats.themes} themes · ${file.run.stats.opportunities} opportunities · $${file.run.stats.costUsd.toFixed(2)}\n`,
  );
}

main().catch((err: unknown) => {
  if (err instanceof PipelineError) {
    fail(`error [${err.code}${err.stage ? ` · ${err.stage}` : ""}]: ${err.message}`, 1);
  }
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  fail(`error: ${message}`, 1);
});

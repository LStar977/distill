import "server-only";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Run, RunFile } from "./types";

const RUNS_DIR = join(process.cwd(), "data", "runs");
const cache = new Map<string, Promise<RunFile | null>>();

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function getRunFile(id: string): Promise<RunFile | null> {
  if (!SAFE_ID.test(id)) return null;
  if (!cache.has(id)) {
    cache.set(
      id,
      readFile(join(RUNS_DIR, `${id}.json`), "utf8")
        .then((text) => {
          const file = JSON.parse(text) as RunFile;
          // The filename is the public id; the pipeline's internal id may differ.
          file.run.id = id;
          return file;
        })
        .catch(() => null),
    );
  }
  return cache.get(id)!;
}

export async function getRun(id: string): Promise<Run | null> {
  const file = await getRunFile(id);
  return file?.run ?? null;
}

export interface RunSummary {
  id: string;
  number: number;
  datasetName: string;
  finishedAt?: string;
  stats: Run["stats"];
  eval?: Run["eval"];
}

export async function listRuns(): Promise<RunSummary[]> {
  let names: string[] = [];
  try {
    names = (await readdir(RUNS_DIR)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const files = await Promise.all(names.map((n) => getRunFile(n.replace(/\.json$/, ""))));
  return files
    .filter((f): f is RunFile => f !== null)
    .map(({ run }) => ({ id: run.id, number: run.number, datasetName: run.datasetName, finishedAt: run.finishedAt, stats: run.stats, eval: run.eval }))
    .sort((a, b) => b.number - a.number);
}

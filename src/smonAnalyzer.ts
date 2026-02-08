import fs from "node:fs";
import path from "node:path";

export type AnalyzeInput = {
  logText?: string;
  logPrefix?: string;
  fromTime?: string;
  toTime?: string;
  managedHosts?: number;
  maxBytes?: number;
  tailLines?: number;
};

export type Finding = {
  type: string;
  severity: "info" | "warn" | "error";
  message: string;
  recommendation?: string;
  count: number;
  samples: string[];
};

export type AnalyzeResult = {
  findings: Finding[];
  summary: string[];
  meta: {
    bytesProcessed: number;
    linesProcessed: number;
    timeWindowApplied: boolean;
  };
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB default cap
const HARD_MAX_BYTES = 20 * 1024 * 1024; // safety ceiling

const timestampRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d{3}/;

const patterns: Array<{
  type: string;
  severity: "info" | "warn" | "error";
  regex: RegExp;
  recommendation?: string;
}> = [
  {
    type: "oom",
    severity: "error",
    regex: /OutOfMemoryError/,
    recommendation: "Increase SMON heap and ensure GC tuning (G1GC).",
  },
  {
    type: "jvm_pause_gc",
    severity: "warn",
    regex: /JvmPause.*no GCs detected/,
    recommendation: "Host under resource pressure; check CPU/RAM and noisy neighbors.",
  },
  {
    type: "jvm_pause_gc",
    severity: "warn",
    regex: /JvmPause.*\b(\d{4,})ms\b/,
    recommendation: "Long GC pauses; consider heap/GC tuning for Service Monitor.",
  },
  {
    type: "rollup_slow",
    severity: "warn",
    regex: /Finished .*rollup: duration=PT(\d+\.\d+)S, numStreamsChecked=/,
    recommendation: "Rollup slow; tune SMON heap, rollup threads/batch sizing, and LevelDB cache.",
  },
  {
    type: "leveldb_error",
    severity: "error",
    regex: /(LDB|LevelDB).*(compaction|write stall|Too many open files|IO error|Corrupt)/i,
    recommendation: "LevelDB stress; consider increasing max open files/cache/write buffer within safe heap limits.",
  },
  {
    type: "deleted_underneath",
    severity: "error",
    regex: /FileNotFound|deleted underneath us/i,
    recommendation: "Logs/LevelDB files removed; check disk cleanup and permissions.",
  },
  {
    type: "task_failure",
    severity: "error",
    regex: /Exception in doWork for task|NullPointerException.*HBaseErasureCodeCanary|firehose polling/i,
    recommendation: "Task failures in SMON polling; investigate failing subsystem (e.g., HBase canary).",
  },
  {
    type: "avro_error",
    severity: "warn",
    regex: /Error proces(s?)ing Avro request/i,
    recommendation: "Avro RPC timeouts; check network latency and SMON GC pauses.",
  },
  {
    type: "scm_proxy_slow",
    severity: "warn",
    regex: /com\.cloudera\.cmf\.PollingScmProxy: run duration exceeded desired period/,
    recommendation: "CM config fetch slow; verify CM health/latency and SMON resources.",
  },
  {
    type: "scm_proxy_error",
    severity: "error",
    regex: /Exception while getting fetch scmDescriptor/i,
    recommendation: "SMON cannot fetch configuration from CM; check CM availability and credentials.",
  },
  {
    type: "acceptance_window",
    severity: "warn",
    regex: /outside acceptance window/i,
    recommendation: "Messages outside acceptance window; possible ingestion lag or time sync issues.",
  },
  {
    type: "slow_query",
    severity: "warn",
    regex: /Slow query detected/i,
    recommendation: "Slow queries may indicate firehose overload; consider increasing non-Java memory.",
  },
  {
    type: "rollup_zero",
    severity: "warn",
    regex: /numStreamsRolledUp=0/,
    recommendation: "Rollup produced zero streams; check raw data availability and rollup tuning.",
  },
];

// Common markers that indicate Service Monitor start/restart events.
const restartMarkers: RegExp[] = [
  /Starting Service Monitor/i,
  /Started Service Monitor/i,
  /Starting cloudera-scm-firehose/i,
  /firehose.*initiali[sz]ed/i,
  /cloudera-scm-firehose version/i,
  /com\.cloudera\.cmon\.firehose\.Main: Starting Firehose/i,
];

// LevelDB tuning info patterns (not errors): capture buffer sizes for context.
const ldbBufferPatterns: Array<{ name: string; regex: RegExp; recommendedMax: number; safetyValve: string }> = [
  {
    name: "write_buffer_stream",
    regex: /LDBTableInfo: Write buffer size for stream:\s*(\d+)/,
    recommendedMax: 268435456,
    safetyValve: "firehose.ldb.write.buffer.rawts.override",
  },
  {
    name: "write_buffer_rollup",
    regex: /LDBTableInfo: Write buffer size for ts_type_rollup_PT600S:\s*(\d+)/,
    recommendedMax: 67108864,
    safetyValve: "firehose.ldb.write.buffer.rollupts.override",
  },
];

function parseTimestamp(line: string): number | undefined {
  const match = line.match(timestampRegex);
  if (!match) return undefined;
  const ts = match[1];
  const d = new Date(ts.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

function withinWindow(line: string, from?: number, to?: number): boolean {
  if (from === undefined && to === undefined) return true;
  const t = parseTimestamp(line);
  if (t === undefined) return true;
  if (from !== undefined && t < from) return false;
  if (to !== undefined && t > to) return false;
  return true;
}

function clampBytes(maxBytes?: number): number {
  if (!maxBytes || Number.isNaN(maxBytes)) return DEFAULT_MAX_BYTES;
  return Math.min(Math.max(1, maxBytes), HARD_MAX_BYTES);
}

function readLogPrefix(logPrefix: string): string {
  const dir = path.dirname(logPrefix);
  const base = path.basename(logPrefix);
  const starIdx = base.indexOf("*");
  const regex = new RegExp("^" + base.split("*").map(escapeRegex).join(".*") + "$");
  const files = fs.readdirSync(dir).filter((f) => regex.test(f)).sort();
  const contents: string[] = [];
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        contents.push(fs.readFileSync(p, "utf8"));
      }
    } catch {
      // ignore unreadable files
    }
  }
  return contents.join("");
}

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

export function analyzeSmonLogs(input: AnalyzeInput): AnalyzeResult {
  const maxBytes = clampBytes(input.maxBytes);
  let text = input.logText;

  if (!text && input.logPrefix) {
    try {
      text = readLogPrefix(input.logPrefix);
    } catch (err: any) {
      throw new Error(`Failed to read logPrefix: ${err?.message || err}`);
    }
  }

  if (!text || text.length === 0) {
    throw new Error("No logText provided and no logPrefix content found");
  }

  // Apply byte cap from the end (most recent data is usually last).
  if (text.length > maxBytes) {
    text = text.slice(text.length - maxBytes);
  }

  // Optional tailLines after byte cap.
  if (input.tailLines && input.tailLines > 0) {
    const lines = text.split("\n");
    text = lines.slice(-input.tailLines).join("\n");
  }

  const fromMs = input.fromTime ? Date.parse(input.fromTime) : undefined;
  const toMs = input.toTime ? Date.parse(input.toTime) : undefined;
  const timeWindowApplied = Boolean(input.fromTime || input.toTime);

  const findingsMap = new Map<string, Finding>();
  const lines = text.split("\n");
  let processed = 0;
  const ctx: Record<string, number | string> = {};

  for (const line of lines) {
    if (!withinWindow(line, fromMs, toMs)) continue;
    processed++;

    // Detect restart markers separately so we can count restarts distinctly.
    for (const r of restartMarkers) {
      if (r.test(line)) {
        const key = "smon_restart";
        const existing = findingsMap.get(key);
        if (existing) {
          existing.count += 1;
          if (existing.samples.length < 3) existing.samples.push(line.trim());
        } else {
          findingsMap.set(key, {
            type: "smon_restart",
            severity: "info",
            message: "Service Monitor start/restart detected",
            recommendation: "Validate SMON uptime and ensure restarts are expected; review heap/GC if frequent.",
            count: 1,
            samples: [line.trim()],
          });
        }
      }
    }

    for (const p of patterns) {
      if (p.regex.test(line)) {
        const key = p.type + p.severity + p.recommendation;
        const existing = findingsMap.get(key);
        if (existing) {
          existing.count += 1;
          if (existing.samples.length < 3) existing.samples.push(line.trim());
        } else {
          findingsMap.set(key, {
            type: p.type,
            severity: p.severity,
            message: line.trim(),
            recommendation: p.recommendation,
            count: 1,
            samples: [line.trim()],
          });
        }
      }
    }

    // Rollup duration threshold: warn if > 60s.
    const rollupMatch = line.match(/Finished .*rollup: duration=PT([\d.]+)S/);
    if (rollupMatch) {
      const durSec = parseFloat(rollupMatch[1]);
      if (!Number.isNaN(durSec) && durSec > 60) {
        const key = "rollup_slow_threshold";
        const msg = `Rollup duration ${durSec.toFixed(1)}s exceeds 60s: ${line.trim()}`;
        if (findingsMap.has(key)) {
          const f = findingsMap.get(key)!;
          f.count += 1;
          if (f.samples.length < 3) f.samples.push(line.trim());
        } else {
          findingsMap.set(key, {
            type: "rollup_slow",
            severity: "warn",
            message: msg,
            recommendation: "Rollup slow; consider increasing SMON heap and tuning rollup threads/batch sizing.",
            count: 1,
            samples: [line.trim()],
          });
        }
      }
    }

    // LevelDB buffer tuning info
    for (const p of ldbBufferPatterns) {
      const m = line.match(p.regex);
      if (m) {
        const val = Number(m[1]);
        if (!Number.isNaN(val)) {
          ctx[p.name] = val;
          if (val < p.recommendedMax) {
            const key = `ldb_buffer_${p.name}`;
            findingsMap.set(key, {
              type: "leveldb_tuning",
              severity: "info",
              message: `${p.name} buffer ${val} < recommended ${p.recommendedMax}`,
              recommendation: `Consider setting ${p.safetyValve}=${p.recommendedMax} if memory budget allows.`,
              count: 1,
              samples: [line.trim()],
            });
          }
        }
      }
    }

    // Total entities context
    const entitiesMatch = line.match(/(.*) Total Entities$/);
    if (entitiesMatch) {
      const num = entitiesMatch[1].trim();
      ctx["total_entities"] = num;
    }
  }

  const findings = Array.from(findingsMap.values()).sort((a, b) => b.count - a.count);

  // If no findings, emit a benign info note.
  if (findings.length === 0) {
    findings.push({
      type: "info",
      severity: "info",
      message: "No known SMON issues detected in provided logs.",
      count: 1,
      samples: [],
    });
  }

  // Build a short summary from top findings.
  const summary: string[] = [];
  const top = findings.slice(0, 5);
  for (const f of top) {
    summary.push(`${f.severity.toUpperCase()} ${f.type}: ${f.message}`);
  }

  return {
    findings,
    summary,
    meta: {
      bytesProcessed: Buffer.byteLength(text, "utf8"),
      linesProcessed: processed,
      timeWindowApplied,
    },
  };
}

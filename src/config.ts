export interface CmConfig {
  baseUrl: string;
  username: string;
  password: string;
  apiVersion?: string; // e.g., "v54"
  verifySsl: boolean;
  requestTimeoutMs: number;
  logLevel: "error" | "warn" | "info" | "debug";
}

export function loadConfigFromEnv(): CmConfig {
  const baseUrl = process.env.CLDR_CM_BASE_URL || "";
  const username = process.env.CLDR_CM_USERNAME || "";
  const password = process.env.CLDR_CM_PASSWORD || "";
  const apiVersion = process.env.CLDR_CM_API_VERSION;
  const verifySsl = (process.env.CLDR_CM_VERIFY_SSL ?? "true").toLowerCase() !== "false";
  const timeoutRaw = process.env.CLDR_CM_REQUEST_TIMEOUT_MS;
  const requestTimeoutMs = timeoutRaw ? Math.max(1, Number(timeoutRaw)) : 15000;
  const logLevelEnv = (process.env.CLDR_CM_LOG_LEVEL ?? "error").toLowerCase();
  const logLevel: CmConfig["logLevel"] = ["error", "warn", "info", "debug"].includes(logLevelEnv)
    ? (logLevelEnv as CmConfig["logLevel"])
    : "error";

  if (!baseUrl) throw new Error("CLDR_CM_BASE_URL is required");
  if (!username) throw new Error("CLDR_CM_USERNAME is required");
  if (!password) throw new Error("CLDR_CM_PASSWORD is required");

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    username,
    password,
    apiVersion,
    verifySsl,
    requestTimeoutMs,
    logLevel,
  };
}

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void
): Promise<void> {
  const original = { ...process.env };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    // Restore original environment (remove any keys introduced by overrides)
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export async function withMockedFetch(fetchImpl: FetchImpl, fn: () => Promise<void> | void): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  try {
    globalThis.fetch = fetchImpl as typeof globalThis.fetch;
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTlsRejectUnauthorized === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsRejectUnauthorized;
  }
}


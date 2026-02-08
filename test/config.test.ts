import assert from "node:assert/strict";
import test from "node:test";
import { loadConfigFromEnv } from "../src/config.js";
import { withEnv } from "./helpers.js";

test("loadConfigFromEnv trims trailing slash from baseUrl", async () => {
  await withEnv(
    {
      CLDR_CM_BASE_URL: "https://cm.example.com:7183/",
      CLDR_CM_USERNAME: "user",
      CLDR_CM_PASSWORD: "pass",
      CLDR_CM_VERIFY_SSL: "true",
    },
    () => {
      const cfg = loadConfigFromEnv();
      assert.equal(cfg.baseUrl, "https://cm.example.com:7183");
    }
  );
});

test("loadConfigFromEnv sets default request timeout and parses overrides", async () => {
  await withEnv(
    {
      CLDR_CM_BASE_URL: "https://cm.example.com:7183/",
      CLDR_CM_USERNAME: "user",
      CLDR_CM_PASSWORD: "pass",
    },
    () => {
      const cfg = loadConfigFromEnv();
      assert.equal(cfg.requestTimeoutMs, 15000);
    }
  );

  await withEnv(
    {
      CLDR_CM_BASE_URL: "https://cm.example.com:7183/",
      CLDR_CM_USERNAME: "user",
      CLDR_CM_PASSWORD: "pass",
      CLDR_CM_REQUEST_TIMEOUT_MS: "2500",
    },
    () => {
      const cfg = loadConfigFromEnv();
      assert.equal(cfg.requestTimeoutMs, 2500);
    }
  );
});

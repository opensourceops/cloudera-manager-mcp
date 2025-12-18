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


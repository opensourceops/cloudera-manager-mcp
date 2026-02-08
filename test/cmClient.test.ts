import assert from "node:assert/strict";
import test from "node:test";
import { ClouderaManagerClient } from "../src/cmClient.js";
import { withMockedFetch } from "./helpers.js";

test("resolveVersion parses quoted version string", async () => {
  await withMockedFetch(async (input) => {
    const url = String(input);
    if (!url.endsWith("/api/version")) throw new Error(`Unexpected URL: ${url}`);
    return new Response("\"v54\"", { status: 200 });
  }, async () => {
    const cm = new ClouderaManagerClient({
      baseUrl: "https://cm.example.com:7183",
      username: "user",
      password: "pass",
      verifySsl: true,
      logLevel: "error",
      requestTimeoutMs: 5000,
    });

    const v = await cm.resolveVersion();
    assert.equal(v, "v54");
  });
});

test("listClusters builds correct URL and Basic auth header", async () => {
  await withMockedFetch(async (input, init) => {
    const url = String(input);

    assert.equal(url, "https://cm.example.com:7183/api/v54/clusters?view=summary");
    assert.equal(init?.method, "GET");

    const headers = init?.headers as Record<string, string> | undefined;
    assert.ok(headers);
    assert.equal(headers["Accept"], "application/json");

    const expectedAuth = `Basic ${Buffer.from("user:pass").toString("base64")}`;
    assert.equal(headers["Authorization"], expectedAuth);

    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const cm = new ClouderaManagerClient({
      baseUrl: "https://cm.example.com:7183",
      username: "user",
      password: "pass",
      apiVersion: "v54",
      verifySsl: true,
      logLevel: "error",
      requestTimeoutMs: 5000,
    });

    const clusters = await cm.listClusters("summary");
    assert.deepEqual(clusters, { items: [] });
  });
});

test("listServices URL-encodes cluster name", async () => {
  await withMockedFetch(
    async (input) => {
      const url = String(input);
      assert.equal(
        url,
        "https://cm.example.com:7183/api/v54/clusters/Cluster%201%2FProd/services?view=summary"
      );
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    async () => {
    const cm = new ClouderaManagerClient({
      baseUrl: "https://cm.example.com:7183",
      username: "user",
      password: "pass",
      apiVersion: "v54",
      verifySsl: true,
      logLevel: "error",
      requestTimeoutMs: 5000,
    });

      const services = await cm.listServices("Cluster 1/Prod", "summary");
      assert.deepEqual(services, { items: [] });
    }
  );
});

test("listClusters error includes response body", async () => {
  await withMockedFetch(
    async () => {
      return new Response("boom", { status: 500, statusText: "Internal Server Error" });
    },
    async () => {
    const cm = new ClouderaManagerClient({
      baseUrl: "https://cm.example.com:7183",
      username: "user",
      password: "pass",
      apiVersion: "v54",
      verifySsl: true,
      logLevel: "error",
      requestTimeoutMs: 5000,
    });

      await assert.rejects(
        () => cm.listClusters("summary"),
        (err: any) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /listClusters failed:/);
          assert.match(err.message, /500/);
          assert.match(err.message, /boom/);
          return true;
        }
      );
    }
  );
});

test("serviceCommand URL-encodes cluster and service and uses POST", async () => {
  await withMockedFetch(
    async (input, init) => {
      const url = String(input);
      assert.equal(
        url,
        "https://cm.example.com:7183/api/v54/clusters/Cluster%201%2FProd/services/HDFS%3A%20NameNode/commands/restart"
      );
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ id: 123, name: "restart" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    async () => {
    const cm = new ClouderaManagerClient({
      baseUrl: "https://cm.example.com:7183",
      username: "user",
      password: "pass",
      apiVersion: "v54",
      verifySsl: true,
      logLevel: "error",
      requestTimeoutMs: 5000,
    });

      const cmd = await cm.serviceCommand("Cluster 1/Prod", "HDFS: NameNode", "restart");
      assert.deepEqual(cmd, { id: 123, name: "restart" });
    }
  );
});

test("getDeployment calls /cm/deployment", async () => {
  await withMockedFetch(
    async (input, init) => {
      const url = String(input);
      assert.equal(url, "https://cm.example.com:7183/api/v54/cm/deployment");
      assert.equal(init?.method, "GET");
      return new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    async () => {
    const cm = new ClouderaManagerClient({
      baseUrl: "https://cm.example.com:7183",
      username: "user",
      password: "pass",
      apiVersion: "v54",
      verifySsl: true,
      logLevel: "error",
      requestTimeoutMs: 5000,
    });

      const deployment = await cm.getDeployment();
      assert.deepEqual(deployment, { hello: "world" });
    }
  );
});

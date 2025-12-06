import { loadConfigFromEnv } from "../config.js";
import { ClouderaManagerClient } from "../cmClient.js";

async function main() {
  try {
    const cfg = loadConfigFromEnv();
    const cm = new ClouderaManagerClient(cfg);

    const info = await cm.getApiInfo();
    // eslint-disable-next-line no-console
    console.log("API Info:", info);

    const clusters = await cm.listClusters("summary");
    // eslint-disable-next-line no-console
    console.log("Clusters:", JSON.stringify(clusters, null, 2));

    const first = clusters?.items?.[0]?.name || clusters?.[0]?.name;
    if (first) {
      const services = await cm.listServices(first, "summary");
      // eslint-disable-next-line no-console
      console.log(`Services for ${first}:`, JSON.stringify(services, null, 2));
    } else {
      // eslint-disable-next-line no-console
      console.log("No clusters found to list services.");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Smoke test failed:", err);
    process.exit(1);
  }
}

main();


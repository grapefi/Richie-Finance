import { address, code, context, deploy, entry, future, uint, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const share = address("TOMB_SHARE_ADDRESS");
  const start = process.env.TOMB_FARM_START_TIME ? uint("TOMB_FARM_START_TIME") : uint("TOMB_START_TIME");
  await code(ctx, share);
  await future(ctx, start, "TOMB_FARM_START_TIME");
  return deploy(ctx, "farm", "TOMB_FARM_ADDRESS", [share, start]);
}
await entry(import.meta.url, () => main());

import { address, code, context, deploy, entry, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const args = [address("TOMB_SHARE_ADDRESS"), address("TOMB_REBATE_SHARE_ORACLE_ADDRESS"), address("TOMB_TREASURY_ADDRESS")];
  for (const target of args) await code(ctx, target);
  return deploy(ctx, "rebates", "TOMB_REBATES_ADDRESS", args);
}
await entry(import.meta.url, () => main());

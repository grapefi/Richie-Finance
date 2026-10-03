import { address, context, contract, entry, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const seen = new Set<string>();
  for (const env of ["TOMB_ORACLE_ADDRESS", "TOMB_SHARE_ORACLE_ADDRESS", "TOMB_REBATE_SHARE_ORACLE_ADDRESS", "TOMB_REBATE_PLS_ORACLE_ADDRESS"]) {
    if (!process.env[env]) continue;
    const target = address(env);
    if (seen.has(target)) continue;
    seen.add(target);
    const oracle = await contract(ctx, "oracle", env);
    const block = await ctx.ethers.provider.getBlock("latest");
    const nextUpdate = await oracle.blockTimestampLast() + await oracle.getPeriod();
    if (!block || BigInt(block.timestamp) < nextUpdate) {
      console.log(`${env}: wait until Unix time ${nextUpdate} before updating a full observation period.`);
      continue;
    }
    const tx = await oracle.update();
    await tx.wait();
    console.log(`${env}: updated (${tx.hash}).`);
  }
  if (seen.size === 0) throw new Error("Set at least one oracle address");
}
await entry(import.meta.url, () => main());

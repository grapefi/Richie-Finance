import { address, code, context, deploy, entry, uint, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const share = address("TOMB_SHARE_ADDRESS");
  const shareOracle = address("TOMB_SHARE_ORACLE_ADDRESS");
  const plsOracle = address("TOMB_REBATE_PLS_ORACLE_ADDRESS");
  for (const target of [share, shareOracle, plsOracle]) await code(ctx, target);
  const age = uint("TOMB_REBATE_MAX_ORACLE_AGE", 86400n);
  const adapter = await deploy(ctx, "rebateComposite", "TOMB_REBATE_COMPOSITE_ORACLE_ADDRESS", [share, shareOracle, plsOracle, age]);
  console.log(`TOMB_REBATE_SHARE_ORACLE_ADDRESS=${await adapter.getAddress()}`);
  console.log("Save BOTH printed oracle variables. No RICH/USDC LP is needed; update both underlying oracles before accepting deposits.");
  return adapter;
}
await entry(import.meta.url, () => main());

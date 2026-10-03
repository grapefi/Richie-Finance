import { address, code, context, deploy, entry, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const peg = address("TOMB_PEG_ADDRESS");
  const pair = address("TOMB_PEG_PDAI_PAIR_ADDRESS");
  await code(ctx, peg);
  await code(ctx, pair);
  await code(ctx, "0x165C3410fC91EF562C50559f7d2289fEbed552d9");
  return deploy(ctx, "zap", "TOMB_ZAP_ADDRESS", [peg, pair]);
}
await entry(import.meta.url, () => main());

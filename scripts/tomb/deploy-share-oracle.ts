import { Contract } from "ethers";
import { address, code, context, deploy, entry, uint, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const pairAddress = address("TOMB_SHARE_PAIR_ADDRESS");
  const share = address("TOMB_SHARE_ADDRESS");
  await code(ctx, pairAddress);
  const pair = new Contract(pairAddress, ["function token0() view returns(address)", "function token1() view returns(address)", "function getReserves() view returns(uint112,uint112,uint32)"], ctx.signer);
  const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
  const tokens = [await pair.token0(), await pair.token1()].map((token) => token.toLowerCase());
  if (!tokens.includes(share.toLowerCase()) || !tokens.includes(WPLS.toLowerCase())) throw new Error("TOMB_SHARE_PAIR_ADDRESS must be SHARE/WPLS");
  const reserves = await pair.getReserves();
  if (reserves[0] === 0n || reserves[1] === 0n) throw new Error("SHARE/WPLS pair needs liquidity first");
  const period = uint("TOMB_SHARE_ORACLE_PERIOD", 3600n);
  const start = process.env.TOMB_SHARE_ORACLE_START_TIME ? uint("TOMB_SHARE_ORACLE_START_TIME") : uint("TOMB_START_TIME");
  if (period < 3600n || period > 172800n || start < period) throw new Error("Oracle period must be 1–48 hours and start >= period");
  return deploy(ctx, "oracle", "TOMB_SHARE_ORACLE_ADDRESS", [pairAddress, period, start]);
}
await entry(import.meta.url, () => main());

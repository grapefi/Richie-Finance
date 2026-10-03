import { Contract } from "ethers";
import { address, code, context, deploy, entry, uint, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const pairAddress = address("TOMB_REBATE_SHARE_PAIR_ADDRESS");
  const share = address("TOMB_SHARE_ADDRESS");
  await code(ctx, pairAddress);
  const pair = new Contract(pairAddress, ["function token0() view returns(address)", "function token1() view returns(address)", "function getReserves() view returns(uint112,uint112,uint32)"], ctx.signer);
  const USDC = "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07";
  const tokens = [await pair.token0(), await pair.token1()].map((token) => token.toLowerCase());
  if (!tokens.includes(share.toLowerCase()) || !tokens.includes(USDC)) throw new Error("Rebate pricing pair must be SHARE/bridged USDC");
  const reserves = await pair.getReserves();
  if (reserves[0] === 0n || reserves[1] === 0n) throw new Error("SHARE/USDC pair needs liquidity first");
  const period = uint("TOMB_REBATE_ORACLE_PERIOD", 3600n);
  const start = uint("TOMB_REBATE_ORACLE_START_TIME");
  if (period < 3600n || period > 172800n || start < period) throw new Error("Oracle period must be 1–48 hours and start >= period");
  return deploy(ctx, "oracle", "TOMB_REBATE_SHARE_ORACLE_ADDRESS", [pairAddress, period, start]);
}
await entry(import.meta.url, () => main());

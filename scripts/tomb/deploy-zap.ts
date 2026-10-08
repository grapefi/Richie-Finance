import { address, code, context, deploy, entry, type Context } from "./helpers.js";
import { getAddress } from "ethers";

const ROUTER = "0x165C3410fC91EF562C50559f7d2289fEbed552d9";
const FACTORY = "0x29eA7545DEf87022BAdc76323F373EA1e707C523";
const PDAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

export async function validatePair(ctx: Context, pair: string, token: string, quote: string, label: string) {
  if (pair === token || pair === quote) throw new Error(`${label} must be the LP address, not an underlying token address`);
  await code(ctx, pair);
  const lp = await ctx.ethers.getContractAt(["function factory() view returns(address)", "function token0() view returns(address)", "function token1() view returns(address)", "function getReserves() view returns(uint112,uint112,uint32)"], pair, ctx.signer);
  const factory = await ctx.ethers.getContractAt(["function getPair(address,address) view returns(address)"], FACTORY, ctx.signer);
  const [a, b, ownerFactory, reserves, registered] = await Promise.all([lp.token0(), lp.token1(), lp.factory(), lp.getReserves(), factory.getPair(token, quote)]);
  if (getAddress(ownerFactory) !== FACTORY || getAddress(registered) !== getAddress(pair)) throw new Error(`${label} is not the registered PulseX V2 pair`);
  if (!((getAddress(a) === token && getAddress(b) === quote) || (getAddress(a) === quote && getAddress(b) === token))) throw new Error(`${label} contains the wrong tokens`);
  if (reserves[0] === 0n || reserves[1] === 0n) throw new Error(`${label} needs liquidity before deploying the zap`);
}

export async function main(ctx?: Context) {
  ctx ??= await context();
  const peg = address("TOMB_PEG_ADDRESS");
  const pair = address("TOMB_PEG_PDAI_PAIR_ADDRESS", process.env.TOMB_PAIR_ADDRESS);
  const share = address("TOMB_SHARE_ADDRESS");
  const sharePair = address("TOMB_SHARE_PAIR_ADDRESS");
  await code(ctx, peg);
  await code(ctx, share);
  await code(ctx, ROUTER);
  await code(ctx, FACTORY);
  const router = await ctx.ethers.getContractAt(["function factory() view returns(address)", "function WPLS() view returns(address)"], ROUTER, ctx.signer);
  if (getAddress(await router.factory()) !== FACTORY || getAddress(await router.WPLS()) !== WPLS) throw new Error("Unexpected PulseX router configuration");
  // Validate BOTH before submitting either deployment.
  await validatePair(ctx, pair, peg, PDAI, "TOMB_PEG_PDAI_PAIR_ADDRESS");
  await validatePair(ctx, sharePair, share, WPLS, "TOMB_SHARE_PAIR_ADDRESS");
  const pegZap = await deploy(ctx, "zap", "TOMB_ZAP_ADDRESS", [peg, pair]);
  const shareZap = await deploy(ctx, "shareZap", "TOMB_SHARE_ZAP_ADDRESS", [share, sharePair]);
  return { pegZap, shareZap };
}
await entry(import.meta.url, () => main());

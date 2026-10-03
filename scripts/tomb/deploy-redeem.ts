import { address, code, context, deploy, entry, type Context } from "./helpers.js";
import { Contract } from "ethers";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const peg = address("TOMB_PEG_ADDRESS");
  const pdai = address("TOMB_PDAI_ADDRESS", "0x6B175474E89094C44Da98b954EedeAC495271d0F");
  if (peg === pdai) throw new Error("PEG and PDAI must differ");
  await code(ctx, peg);
  await code(ctx, pdai);
  const tokenABI = ["function decimals() view returns(uint8)"];
  if (await new Contract(peg, tokenABI, ctx.signer).decimals() !== await new Contract(pdai, tokenABI, ctx.signer).decimals()) {
    throw new Error("PegRedeem uses raw 1:1 amounts; PEG and PDAI decimals must match");
  }
  return deploy(ctx, "redeem", "TOMB_REDEEM_ADDRESS", [peg, pdai]);
}
await entry(import.meta.url, () => main());

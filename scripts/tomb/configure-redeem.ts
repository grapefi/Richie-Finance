import { Contract } from "ethers";
import { authority, context, contract, entry, send, uint, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const redeem = await contract(ctx, "redeem", "TOMB_REDEEM_ADDRESS");
  await authority(ctx, redeem, "owner");
  // Target reserve, not an additive amount: rerunning cannot deposit twice.
  const target = uint("TOMB_REDEEM_PDAI_RESERVE_WEI");
  const token = new Contract(await redeem.PDAI(), ["function balanceOf(address) view returns(uint256)", "function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)"], ctx.signer);
  const balance = await token.balanceOf(await redeem.getAddress());
  if (balance >= target) { console.log("PegRedeem already has the target PDAI reserve."); return; }
  const amount = target - balance;
  if (await token.balanceOf(ctx.signer.address) < amount) throw new Error("Signer has insufficient PDAI for target reserve");
  if (await token.allowance(ctx.signer.address, await redeem.getAddress()) < amount) {
    if (await token.allowance(ctx.signer.address, await redeem.getAddress()) > 0n) await send("Reset PDAI approval", () => token.approve(redeem.getAddress(), 0));
    await send("Approve PDAI reserve funding", () => token.approve(redeem.getAddress(), amount));
  }
  await send("Supply PDAI reserve", () => redeem.supplyPDAI(amount));
}
await entry(import.meta.url, () => main());

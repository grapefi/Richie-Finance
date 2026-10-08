import { getAddress } from "ethers";
import { address, authority, context, contract, entry, send, type Context } from "./helpers.js";

// Explicit final step, after configuring and funding everything.
export async function main(ctx?: Context) {
  ctx ??= await context();
  const admin = address("TOMB_ADMIN_ADDRESS");
  const changes: { target: Awaited<ReturnType<typeof contract>>; getter: string; setter: string }[] = [];
  const roles = [
    ["peg", "TOMB_PEG_ADDRESS", "owner", "transferOwnership"],
    ["share", "TOMB_SHARE_ADDRESS", "owner", "transferOwnership"],
    ["treasury", "TOMB_TREASURY_ADDRESS", "operator", "setOperator"],
    ["genesis", "TOMB_GENESIS_ADDRESS", "operator", "setOperator"],
    ["farm", "TOMB_FARM_ADDRESS", "operator", "setOperator"],
    ["oracle", "TOMB_ORACLE_ADDRESS", "operator", "transferOperator"],
    ["oracle", "TOMB_ORACLE_ADDRESS", "owner", "transferOwnership"],
    ["oracle", "TOMB_SHARE_ORACLE_ADDRESS", "operator", "transferOperator"],
    ["oracle", "TOMB_SHARE_ORACLE_ADDRESS", "owner", "transferOwnership"],
    ["oracle", "TOMB_REBATE_SHARE_ORACLE_ADDRESS", "operator", "transferOperator"],
    ["oracle", "TOMB_REBATE_SHARE_ORACLE_ADDRESS", "owner", "transferOwnership"],
    ["oracle", "TOMB_REBATE_PLS_ORACLE_ADDRESS", "operator", "transferOperator"],
    ["oracle", "TOMB_REBATE_PLS_ORACLE_ADDRESS", "owner", "transferOwnership"],
    ["redeem", "TOMB_REDEEM_ADDRESS", "owner", "transferOwnership"],
    ["rebates", "TOMB_REBATES_ADDRESS", "owner", "transferOwnership"],
    ["zap", "TOMB_ZAP_ADDRESS", "owner", "transferOwnership"],
    ["shareZap", "TOMB_SHARE_ZAP_ADDRESS", "owner", "transferOwnership"],
  ] as const;
  const seen = new Set<string>();
  for (const [kind, env, getter, setter] of roles) {
    if (!process.env[env]) continue;
    const target = await contract(ctx, kind, env);
    const key = `${await target.getAddress()}:${getter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (getAddress(await target[getter]()) === admin) continue;
    // Oracle operator transfer is owner-authorized; other operator changes require the operator.
    await authority(ctx, target, setter === "transferOperator" ? "owner" : getter);
    changes.push({ target, getter, setter });
  }
  for (const { target, getter, setter } of changes) await send(`Transfer ${await target.getAddress()} ${getter} to ${admin}`, () => target[setter](admin));
  console.log("Administration transferred. Boardroom/PEG/SHARE operational permissions stay with Treasury.");
}
await entry(import.meta.url, () => main());

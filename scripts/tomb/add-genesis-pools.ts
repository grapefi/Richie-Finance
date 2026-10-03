import { getAddress, isAddress, ZeroAddress } from "ethers";
import { address, authority, code, context, contract, entry, jsonArray, jsonUint, send, type Context } from "./helpers.js";

type PoolConfig = {
  token: string;
  allocPoint: string | number;
  depositFeeBps?: number;
  lastRewardTime?: string | number;
};

export async function main(ctx?: Context) {
  ctx ??= await context();
  const genesis = await contract(ctx, "genesis", "TOMB_GENESIS_ADDRESS");
  await authority(ctx, genesis);
  const pools = jsonArray<PoolConfig>("TOMB_GENESIS_POOLS");
  const seen = new Set<string>();
  for (const pool of pools) {
    if (!isAddress(pool.token) || getAddress(pool.token) === ZeroAddress) throw new Error("Invalid Genesis pool token");
    pool.token = getAddress(pool.token);
    if (seen.has(pool.token) || pool.token === getAddress(await genesis.peg())) throw new Error("Duplicate pool or PEG staking pool");
    seen.add(pool.token);
    jsonUint(pool.allocPoint, "allocPoint");
    if (jsonUint(pool.lastRewardTime ?? 0, "lastRewardTime") !== 0n) throw new Error("Use lastRewardTime=0 for consistent allocation accounting");
    if (!Number.isInteger(pool.depositFeeBps ?? 0) || (pool.depositFeeBps ?? 0) < 0 || (pool.depositFeeBps ?? 0) > 1000) throw new Error("Deposit fee must be 0–1000 basis points");
    await code(ctx, pool.token);
  }
  const recipient = process.env.TOMB_GENESIS_FEE_RECIPIENT ? address("TOMB_GENESIS_FEE_RECIPIENT") : undefined;
  const existing = new Map<string, bigint>();
  // Genesis has no length getter; enumerate its public array until the bounds revert.
  for (let pid = 0n; ; pid++) {
    try { existing.set(getAddress((await genesis.poolInfo(pid)).token), pid); }
    catch (error) {
      // Solidity's generated public-array getter uses an empty revert for bounds,
      // unlike an explicit array access which emits Panic(0x32).
      const failure = error as { code?: string; data?: string };
      if (String(error).includes("0x32") || String(error).includes("out-of-bounds") ||
          String(error).includes("Transaction reverted without a reason string") ||
          (failure.code === "CALL_EXCEPTION" && failure.data === "0x")) break;
      throw error;
    }
  }
  for (let index = 0; index < pools.length; index += 1) {
    const pool = pools[index];
    if (!isAddress(pool.token)) {
      throw new Error(`Pool ${index} has an invalid token address`);
    }

    const allocPoint = jsonUint(pool.allocPoint, "allocPoint");
    const lastRewardTime = 0n;
    const depositFeeBps = pool.depositFeeBps ?? 0;

    if (depositFeeBps < 0 || depositFeeBps > 1_000) {
      throw new Error(`Pool ${index} depositFeeBps must be between 0 and 1000`);
    }

    console.log(
      `Adding pool ${index}: token=${pool.token}, allocation=${allocPoint}, fee=${depositFeeBps} bps`,
    );
    const pid = existing.get(pool.token);
    if (pid === undefined) await send("Add Genesis pool", () => genesis.add(allocPoint, pool.token, true, lastRewardTime, depositFeeBps));
    else {
      const current = await genesis.poolInfo(pid);
      if (current.allocPoint !== allocPoint) await send(`Set allocation ${pid}`, () => genesis.set(pid, allocPoint));
      if (current.depositFeeBps !== BigInt(depositFeeBps)) await send(`Set deposit fee ${pid}`, () => genesis.setDepositFee(pid, depositFeeBps));
    }
  }

  if (recipient && getAddress(await genesis.feeRecipient()) !== recipient) await send("Set Genesis fee recipient", () => genesis.setFeeRecipient(recipient));
  console.log(`Configured ${pools.length} Genesis pools.`);
}
await entry(import.meta.url, () => main());

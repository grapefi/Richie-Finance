import { Contract, ZeroAddress, getAddress, isAddress } from "ethers";
import { address, authority, code, context, contract, entry, flag, jsonArray, jsonUint, send, uint, type Context } from "./helpers.js";

type Asset = { token: string; isAdded?: boolean; multiplier: string | number; oracle?: string; isLP?: boolean; pair?: string };
export async function main(ctx?: Context) {
  ctx ??= await context();
  const rebates = await contract(ctx, "rebates", "TOMB_REBATES_ADDRESS");
  await authority(ctx, rebates, "owner");
  const discount = uint("TOMB_REBATE_DISCOUNT", 70000n);
  const vesting = uint("TOMB_REBATE_VESTING_SECONDS", 259200n);
  const target = uint("TOMB_REBATE_SHARE_RESERVE_WEI", 0n);
  const age = uint("TOMB_REBATE_MAX_ORACLE_AGE", 86400n);
  if (age < 300n || age > 604800n) throw new Error("Rebate oracle age must be 300–604800 seconds");
  const shareOracleAddress = process.env.TOMB_REBATE_SHARE_ORACLE_ADDRESS
    ? address("TOMB_REBATE_SHARE_ORACLE_ADDRESS") : getAddress(await rebates.ShareOracle());
  await code(ctx, shareOracleAddress);
  const shareOracle = new ctx.ethers.Contract(shareOracleAddress, [
    "function getPeriod() view returns(uint256)", "function token0() view returns(address)",
    "function token1() view returns(address)",
  ], ctx.signer);
  const shareTokens = [getAddress(await shareOracle.token0()), getAddress(await shareOracle.token1())];
  if (!shareTokens.includes(getAddress(await rebates.Share())) || !shareTokens.includes(getAddress(await rebates.USDC()))) {
    throw new Error("Rebate share oracle must quote SHARE in bridged USDC");
  }
  if (await shareOracle.getPeriod() > age) throw new Error("Rebate maximum oracle age must cover its update period");
  if (vesting === 0n) throw new Error("Vesting period must be positive");
  const assets = process.env.TOMB_REBATE_ASSETS ? jsonArray<Asset>("TOMB_REBATE_ASSETS") : [];
  const wpls = getAddress(await rebates.WPLS());
  if (process.env.TOMB_REBATE_PLS_ENABLED) {
    if (assets.some((asset) => isAddress(asset.token) && getAddress(asset.token) === wpls)) throw new Error("Configure WPLS via PLS settings OR asset JSON, not both");
    const current = await rebates.assets(wpls);
    const enabled = flag("TOMB_REBATE_PLS_ENABLED");
    const oracle = process.env.TOMB_REBATE_PLS_ORACLE_ADDRESS ? address("TOMB_REBATE_PLS_ORACLE_ADDRESS") : getAddress(current.oracle);
    const multiplier = uint("TOMB_REBATE_PLS_MULTIPLIER", current.multiplier || 1000000n);
    assets.push({ token: wpls, isAdded: enabled, multiplier: multiplier.toString(), oracle });
  }
  const validated = [];
  for (const asset of assets) {
    if (!isAddress(asset.token) || getAddress(asset.token) === ZeroAddress) throw new Error("Invalid rebate asset token");
    const oracleAddress = asset.oracle ?? ZeroAddress;
    if (!isAddress(oracleAddress)) throw new Error("Invalid rebate oracle address");
    const directUSDC = getAddress(asset.token) === getAddress(await rebates.USDC());
    const added = asset.isAdded ?? true;
    const isLP = asset.isLP ?? false;
    if (added && isLP) throw new Error("LP rebates are not enabled by this script; use direct USDC deposits");
    if (typeof added !== "boolean" || typeof isLP !== "boolean") throw new Error("Asset flags must be booleans");
    const multiplier = jsonUint(asset.multiplier, "multiplier");
    const pair = asset.pair ? getAddress(asset.pair) : ZeroAddress;
    if (added && (multiplier === 0n || (!directUSDC && getAddress(oracleAddress) === ZeroAddress))) throw new Error("Enabled non-USDC asset needs multiplier and oracle");
    if (directUSDC && (isLP || pair !== ZeroAddress || getAddress(oracleAddress) !== ZeroAddress)) throw new Error("Direct USDC does not use an asset oracle or LP pair");
    await code(ctx, getAddress(asset.token));
    if (added && !directUSDC) {
      await code(ctx, getAddress(oracleAddress));
      const oracle = new Contract(oracleAddress, ["function token0() view returns(address)", "function token1() view returns(address)", "function getPeriod() view returns(uint256)"], ctx.signer);
      const tokens = [getAddress(await oracle.token0()), getAddress(await oracle.token1())];
      if (!tokens.includes(getAddress(asset.token)) || !tokens.includes(getAddress(await rebates.USDC()))) throw new Error("Rebate asset oracle must quote bridged USDC");
      if (await oracle.getPeriod() > age) throw new Error("Rebate maximum oracle age must cover the asset oracle period");
    }
    if (added && isLP) await code(ctx, pair);
    validated.push({ ...asset, token: getAddress(asset.token), oracle: getAddress(oracleAddress), multiplier, pair, added, isLP });
  }
  const share = new Contract(await rebates.Share(), ["function balanceOf(address) view returns(uint256)", "function transfer(address,uint256) returns(bool)"], ctx.signer);
  const balance = await share.balanceOf(await rebates.getAddress());
  if (target > balance && await share.balanceOf(ctx.signer.address) < target - balance) throw new Error("Signer has insufficient SHARE for rebate reserve");
  if (getAddress(await rebates.ShareOracle()) !== shareOracleAddress) await send("Set rebate share pricing oracle", () => rebates.setShareOracle(shareOracleAddress));
  if (await rebates.discount() !== discount || await rebates.bondVesting() !== vesting) await send("Set rebate pricing and vesting", () => rebates.setBondParameters(discount, vesting));
  if (await rebates.maxOracleAge() !== age) await send("Set rebate oracle maximum age", () => rebates.setMaxOracleAge(age));
  for (const asset of validated) {
    const current = await rebates.assets(asset.token);
    if (current.isAdded !== asset.added || current.multiplier !== asset.multiplier || getAddress(current.oracle) !== asset.oracle || current.isLP !== asset.isLP || getAddress(current.pair) !== asset.pair) {
      await send(`Configure rebate asset ${asset.token}`, () => rebates.setAsset(asset.token, asset.added, asset.multiplier, asset.oracle, asset.isLP, asset.pair));
    }
  }
  if (target > balance) {
    const amount = target - balance;
    if (await share.balanceOf(ctx.signer.address) < amount) throw new Error("Signer has insufficient SHARE for rebate reserve");
    await send("Fund rebate SHARE reserve", () => share.transfer(rebates.getAddress(), amount));
  }
  console.log("Rebate configuration complete; rebate funding is separate from the farm's 41,000 SHARE allocation.");
}
await entry(import.meta.url, () => main());

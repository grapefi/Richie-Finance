import { getAddress } from "ethers";
import { address, authority, context, contract, entry, send, uint, type Context } from "./helpers.js";

export async function main(ctx?: Context) {
  ctx ??= await context();
  const peg = await contract(ctx, "peg", "TOMB_PEG_ADDRESS");
  const share = await contract(ctx, "share", "TOMB_SHARE_ADDRESS");
  const genesis = await contract(ctx, "genesis", "TOMB_GENESIS_ADDRESS");
  const farm = await contract(ctx, "farm", "TOMB_FARM_ADDRESS");
  const boardroom = await contract(ctx, "boardroom", "TOMB_BOARDROOM_ADDRESS");
  const treasury = await contract(ctx, "treasury", "TOMB_TREASURY_ADDRESS");
  const treasuryAddress = await treasury.getAddress();
  const pegAddress = await peg.getAddress();
  const shareAddress = await share.getAddress();
  const expectedGenesisRewards = 40_176_000n * 10n ** 18n;
  const expectedFarmRewards = 40_000n * 10n ** 18n;
  const expectedFarmDuration = 365n * 86400n;
  if (!(await treasury.initialized()) || !(await boardroom.initialized())) throw new Error("Initialize Treasury and Boardroom with deploy-core.ts first");
  if (getAddress(await genesis.peg()) !== pegAddress || getAddress(await farm.share()) !== shareAddress ||
      getAddress(await treasury.peg()) !== pegAddress || getAddress(await treasury.share()) !== shareAddress ||
      getAddress(await treasury.boardroom()) !== await boardroom.getAddress() ||
      getAddress(await boardroom.peg()) !== pegAddress || getAddress(await boardroom.share()) !== shareAddress ||
      getAddress(await boardroom.treasury()) !== treasuryAddress) throw new Error("Core contract links do not match the configured addresses");
  if (await peg.INITIAL_GENESIS_POOL_DISTRIBUTION() !== expectedGenesisRewards ||
      await genesis.TOTAL_REWARDS() !== expectedGenesisRewards) {
    throw new Error("Genesis contracts must both use 40,176,000 CASH over three days");
  }
  if (await share.FARMING_POOL_REWARD_ALLOCATION() !== expectedFarmRewards ||
      await farm.TOTAL_REWARDS() !== expectedFarmRewards ||
      await farm.runningTime() !== expectedFarmDuration) {
    throw new Error("Share and Farm contracts must both use 40,000 RICH over 365 days");
  }
  await authority(ctx, treasury);
  if (!(await peg.rewardPoolDistributed())) await authority(ctx, peg);
  if (!(await share.rewardPoolDistributed())) await authority(ctx, share);
  for (const token of [peg, share]) {
    if (getAddress(await token.operator()) !== treasuryAddress) await authority(ctx, token, "owner");
  }
  if (getAddress(await boardroom.operator()) !== treasuryAddress) await authority(ctx, boardroom);

  const withdraw = uint("TOMB_BOARDROOM_WITHDRAW_LOCKUP_EPOCHS", await boardroom.withdrawLockupEpochs());
  const reward = uint("TOMB_BOARDROOM_REWARD_LOCKUP_EPOCHS", await boardroom.rewardLockupEpochs());
  if (withdraw < reward || withdraw > 56n) throw new Error("Boardroom lockups must satisfy 0 <= reward <= withdraw <= 56");
  const hasFunds = ["TOMB_DAO_FUND", "TOMB_DAO_FUND_BPS", "TOMB_TREASURY_DEV_FUND", "TOMB_TREASURY_DEV_FUND_BPS"].some((name) => process.env[name]);
  const funds = hasFunds ? [address("TOMB_DAO_FUND"), uint("TOMB_DAO_FUND_BPS"), address("TOMB_TREASURY_DEV_FUND"), uint("TOMB_TREASURY_DEV_FUND_BPS")] as const : undefined;
  if (funds && (funds[1] > 2500n || funds[3] > 500n)) throw new Error("DAO/dev fund shares exceed Treasury limits");
  const ceiling = uint("TOMB_PEG_PRICE_CEILING", await treasury.pegPriceCeiling());
  const one = await treasury.pegPriceOne();
  const bootstrapEpochs = uint("TOMB_BOOTSTRAP_EPOCHS", await treasury.bootstrapEpochs());
  const bootstrapExpansion = uint("TOMB_BOOTSTRAP_EXPANSION_BPS", await treasury.bootstrapSupplyExpansionPercent());
  if (ceiling < one || ceiling > one * 120n / 100n || bootstrapEpochs > 120n || bootstrapExpansion < 100n || bootstrapExpansion > 1000n) throw new Error("Treasury parameters exceed contract limits");

  if (funds && (getAddress(await treasury.daoFund()) !== funds[0] || await treasury.daoFundSharedPercent() !== funds[1] || getAddress(await treasury.devFund()) !== funds[2] || await treasury.devFundSharedPercent() !== funds[3])) await send("Set Treasury funds", () => treasury.setExtraFunds(...funds));
  if (ceiling !== await treasury.pegPriceCeiling()) await send("Set PEG price ceiling", () => treasury.setPegPriceCeiling(ceiling));
  if (bootstrapEpochs !== await treasury.bootstrapEpochs() || bootstrapExpansion !== await treasury.bootstrapSupplyExpansionPercent()) await send("Set bootstrap parameters", () => treasury.setBootstrap(bootstrapEpochs, bootstrapExpansion));
  if (withdraw !== await boardroom.withdrawLockupEpochs() || reward !== await boardroom.rewardLockupEpochs()) {
    if (getAddress(await boardroom.operator()) === treasuryAddress) await send("Set Boardroom lockups through Treasury", () => treasury.boardroomSetLockUp(withdraw, reward));
    else await send("Set Boardroom lockups", () => boardroom.setLockUp(withdraw, reward));
  }
  if (!(await peg.rewardPoolDistributed())) await send("Fund Genesis with 40,176,000 CASH", () => peg.distributeReward(genesis.getAddress()));
  if (!(await share.rewardPoolDistributed())) await send("Fund Farm with 40,000 RICH", () => share.distributeReward(farm.getAddress()));
  if (getAddress(await boardroom.operator()) !== treasuryAddress) await send("Transfer Boardroom operator to Treasury", () => boardroom.setOperator(treasuryAddress));
  if (getAddress(await peg.operator()) !== treasuryAddress) await send("Transfer PEG operator to Treasury", () => peg.transferOperator(treasuryAddress));
  if (getAddress(await share.operator()) !== treasuryAddress) await send("Transfer SHARE operator to Treasury", () => share.transferOperator(treasuryAddress));
  console.log("Core system configured. Treasury administration and the farm operator remain with the signer.");
}
await entry(import.meta.url, () => main());

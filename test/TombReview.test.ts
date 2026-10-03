import { expect } from "chai";
import { network } from "hardhat";
const { ethers, networkHelpers: helpers } = await network.connect();
const E = 10n ** 18n;
const USDC = "0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07";

// These characterize CURRENT behavior, including confirmed bugs. A passing
// reproduction means the finding exists, not that the contract is safe.
describe("Tomb security review: confirmed findings and integration", () => {
  async function poolFixture(genesis: boolean, delayed = false) {
    const [owner, alice, bob] = await ethers.getSigners();
    const reward = await ethers.deployContract("TombReviewToken", [18]);
    const a = await ethers.deployContract("TombReviewToken", [8]);
    const b = await ethers.deployContract("TombReviewToken", [18]);
    const start = BigInt(await helpers.time.latest()) + 1000n;
    const pool = genesis
      ? await ethers.deployContract("GenesisRewardPool", [await reward.getAddress(), start])
      : await ethers.deployContract("ShareRewardPool", [await reward.getAddress(), start]);
    if (genesis) {
      await pool.add(1, await a.getAddress(), true, 0, 0);
      await pool.add(1, await b.getAddress(), true, delayed ? start + 50n : 0, 0);
    } else {
      await pool.add(1, await a.getAddress(), true, 0);
      await pool.add(1, await b.getAddress(), true, delayed ? start + 50n : 0);
    }
    await a.mint(alice.address, 100000000n);
    await b.mint(bob.address, E);
    await a.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256);
    await b.connect(bob).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(alice).deposit(0, 100000000n);
    await pool.connect(bob).deposit(1, E);
    return { owner, alice, bob, reward, a, b, start, pool };
  }
  for (const genesis of [true, false]) {
    const name = genesis ? "Genesis" : "Farm";
    it(`REPRO ${name}: delayed activation creates liabilities exceeding emitted rewards`, async () => {
      const { pool, alice, bob, start } = await poolFixture(genesis, true);
      await helpers.time.setNextBlockTimestamp(start + 100n);
      await pool.updatePool(0);
      await helpers.time.setNextBlockTimestamp(start + 101n);
      await pool.updatePool(1);
      const first = await pool.poolInfo(0), second = await pool.poolInfo(1);
      const acc0 = genesis ? first.accPegPerShare : first.accSharePerShare;
      const acc1 = genesis ? second.accPegPerShare : second.accSharePerShare;
      const liability = (await pool.userInfo(0, alice.address)).amount * acc0 / E +
        (await pool.userInfo(1, bob.address)).amount * acc1 / E;
      expect(liability).to.be.greaterThan(await pool.getGeneratedReward(start, start + 101n));
    });
    it(`REPRO ${name}: add(false) retroactively dilutes accrued rewards`, async () => {
      const { pool, start, a } = await poolFixture(genesis);
      const extra = await ethers.deployContract("TombReviewToken", [18]);
      await helpers.time.setNextBlockTimestamp(start + 100n);
      if (genesis) await pool.add(2, await extra.getAddress(), false, 0, 0);
      else await pool.add(2, await extra.getAddress(), false, 0);
      await pool.updatePool(0);
      const info = await pool.poolInfo(0);
      const acc = genesis ? info.accPegPerShare : info.accSharePerShare;
      const actual = acc * 100000000n / E;
      const generated = await pool.getGeneratedReward(start, BigInt(await helpers.time.latest()));
      expect(actual).to.be.lessThan(generated / 2n);
      expect(await a.balanceOf(await pool.getAddress())).to.equal(100000000n);
    });
    it(`PASS ${name}: 8/18-decimal deposits and normal equal allocations conserve rewards`, async () => {
      const { pool, start, alice, bob } = await poolFixture(genesis);
      await helpers.time.setNextBlockTimestamp(start + 100n);
      await pool.massUpdatePools();
      const total = await pool.getGeneratedReward(start, start + 100n);
      const pa = genesis ? await pool.pendingRewards(0, alice.address) : await pool.pendingShare(0, alice.address);
      const pb = genesis ? await pool.pendingRewards(1, bob.address) : await pool.pendingShare(1, bob.address);
      expect(pa + pb).to.be.at.most(total);
      expect(pa).to.be.closeTo(total / 2n, 1n);
      expect(pb).to.equal(total / 2n);
    });
    it(`REPRO ${name}: emergency withdrawal reallocates the prior interval to remaining users`, async () => {
      const { pool, start, alice, bob, a } = await poolFixture(genesis);
      await a.mint(bob.address, 100000000n);
      await a.connect(bob).approve(await pool.getAddress(), ethers.MaxUint256);
      await pool.connect(bob).deposit(0, 100000000n);
      await helpers.time.setNextBlockTimestamp(start + 100n);
      await pool.connect(alice).emergencyWithdraw(0);
      await pool.updatePool(0);
      const info = await pool.poolInfo(0);
      const acc = genesis ? info.accPegPerShare : info.accSharePerShare;
      const bobRewards = acc * 100000000n / E;
      const elapsed = BigInt(await helpers.time.latest()) - start;
      const rate = genesis ? await pool.pegPerSecond() : await pool.sharePerSecond();
      // Pool has half total allocation; Bob held half its supply for 100 seconds.
      const timeWeightedReward = rate * 100n / 4n + rate * (elapsed - 100n) / 2n;
      expect(bobRewards).to.be.greaterThan(timeWeightedReward);
    });
  }

  it("PASS Genesis: 1% deposit fee on an 8-decimal token credits only the net stake", async () => {
    const { pool, alice, owner, a, b } = await poolFixture(true);
    await pool.connect(alice).withdraw(0, 100000000n);
    await pool.setDepositFee(0, 100);
    await pool.connect(alice).deposit(0, 100000000n);
    expect((await pool.userInfo(0, alice.address)).amount).to.equal(99000000n);
    expect((await pool.poolInfo(0)).totalStaked).to.equal(99000000n);
    expect(await a.balanceOf(owner.address)).to.equal(1000000n);
    expect(await a.balanceOf(await pool.getAddress())).to.equal(99000000n);
    expect((await pool.poolInfo(1)).totalStaked).to.equal(E);
    expect(await b.balanceOf(await pool.getAddress())).to.equal(E);
  });
  it("REPRO Genesis: extra sender tax on the deposit fee undercollateralizes credited stakes", async () => {
    const [owner, user] = await ethers.getSigners();
    const reward = await ethers.deployContract("TombReviewToken", [18]);
    const token = await ethers.deployContract("TombReviewToken", [8]);
    const pool = await ethers.deployContract("GenesisRewardPool", [await reward.getAddress(), BigInt(await helpers.time.latest()) + 100n]);
    await pool.add(1, await token.getAddress(), true, 0, 1000);
    await token.setSenderFee(1000); await token.mint(user.address, 110000000n);
    await token.connect(user).approve(await pool.getAddress(), 100000000n);
    await pool.connect(user).deposit(0, 100000000n);
    expect((await pool.poolInfo(0)).totalStaked).to.equal(90000000n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(89000000n);
    expect(await token.balanceOf(owner.address)).to.equal(10000000n);
  });

  it("REPRO Genesis: pending view divides by zero after all allocations are zero", async () => {
    const { pool, alice, start } = await poolFixture(true);
    await pool.set(0, 0); await pool.set(1, 0);
    await helpers.time.increaseTo(start + 100n);
    await expect(pool.pendingRewards(0, alice.address)).to.be.revertedWithPanic(0x12);
    // Actual withdrawals do not have the view's division-by-zero bug.
    await pool.connect(alice).withdraw(0, 100000000n);
  });
  it("REPRO Genesis: unfunded earned PEG is erased rather than carried forward", async () => {
    const { pool, alice, start, reward } = await poolFixture(true);
    await helpers.time.setNextBlockTimestamp(start + 100n);
    await pool.connect(alice).deposit(0, 0);
    expect(await reward.balanceOf(alice.address)).to.equal(0n);
    expect(await pool.pendingRewards(0, alice.address)).to.equal(0n);
    await reward.mint(await pool.getAddress(), 2400n * E);
    expect(await pool.pendingRewards(0, alice.address)).to.be.lessThan(E); // past 100 seconds are lost
  });
  it("REPRO Farm: operator can remove every SHARE reserved for rewards", async () => {
    const { pool, reward, owner } = await poolFixture(false);
    await reward.mint(await pool.getAddress(), 41000n * E);
    await pool.governanceRecoverUnsupported(await reward.getAddress(), 41000n * E, owner.address);
    expect(await reward.balanceOf(await pool.getAddress())).to.equal(0n);
  });
  it("REPRO Farm: sender-side tax creates an insolvent staking balance", async () => {
    const { pool, alice, a } = await poolFixture(false);
    await a.mint(alice.address, 100000000n);
    await a.setSenderFee(1000);
    await pool.connect(alice).withdraw(0, 50000000n);
    expect((await pool.poolInfo(0)).totalStaked).to.equal(50000000n);
    expect(await a.balanceOf(await pool.getAddress())).to.equal(45000000n);
    await expect(pool.connect(alice).withdraw(0, 50000000n)).to.revert(ethers);
  });

  it("REPRO Oracle 0.6: permissionless updates one second apart overwrite a full TWAP", async () => {
    const [owner, outsider] = await ethers.getSigners();
    const pair = await ethers.deployContract("TombReviewPair", [owner.address, outsider.address, E, 20n * E]);
    const start = BigInt(await helpers.time.latest()) + 10n;
    const oracle = await ethers.deployContract("contracts/tomb/Oracle.sol:Oracle", [await pair.getAddress(), 3600, start]);
    // Initial nextEpochPoint is start. Update just before the next scheduled boundary.
    await helpers.time.setNextBlockTimestamp(start + 3598n);
    await pair.changeReserves(E, E);
    await helpers.time.setNextBlockTimestamp(start + 3599n);
    await oracle.connect(outsider).update();
    expect(await oracle.consult(owner.address, E)).to.be.greaterThan(19n * E);
    const before = await oracle.blockTimestampLast();
    await helpers.time.setNextBlockTimestamp(start + 3600n);
    await oracle.connect(outsider).update();
    expect(await oracle.blockTimestampLast() - before).to.equal(1n);
    expect(await oracle.consult(owner.address, E)).to.equal(E);
    // twap() at the just-updated timestamp divides by zero.
    await expect(oracle.twap(owner.address, E)).to.revert(ethers);
  });

  async function coreFixture() {
    const [owner, user, dao, dev] = await ethers.getSigners();
    const peg = await ethers.deployContract("contracts/tomb/Peg.sol:Peg");
    const start = BigInt(await helpers.time.latest()) + 1000n;
    const share = await ethers.deployContract("contracts/tomb/Share.sol:Share", [start, dao.address, dev.address]);
    const boardroom = await ethers.deployContract("Boardroom");
    const treasury = await ethers.deployContract("Treasury");
    const oracle = await ethers.deployContract("TombReviewPriceOracle", [await peg.getAddress(), dao.address, 11n * E / 10n]);
    await treasury.initialize(await peg.getAddress(), await share.getAddress(), await oracle.getAddress(), await boardroom.getAddress(), start);
    await boardroom.initialize(await peg.getAddress(), await share.getAddress(), await treasury.getAddress());
    await peg.mint(user.address, 1000n * E);
    await peg.transferOperator(await treasury.getAddress());
    await share.transferOperator(await treasury.getAddress());
    await boardroom.setOperator(await treasury.getAddress());
    await share.approve(await boardroom.getAddress(), E);
    await boardroom.stake(E);
    return { owner, user, dao, dev, peg, share, boardroom, treasury, oracle, start };
  }
  it("PASS core: Treasury mints correct bootstrap fractions, pays funds, and Boardroom settles PEG", async () => {
    const { owner, dao, dev, peg, share, boardroom, treasury, start } = await coreFixture();
    await treasury.setExtraFunds(dao.address, 1000, dev.address, 500);
    const supply = await peg.totalSupply();
    const minted = supply * 250n / 10000n;
    const daoAmount = minted / 10n, devAmount = minted * 500n / 10000n;
    await helpers.time.setNextBlockTimestamp(start);
    await treasury.allocateSeigniorage();
    expect(await peg.totalSupply()).to.equal(supply + minted);
    expect(await peg.balanceOf(dao.address)).to.equal(daoAmount);
    expect(await peg.balanceOf(dev.address)).to.equal(devAmount);
    expect(await boardroom.earned(owner.address)).to.equal(minted - daoAmount - devAmount);
    await treasury.boardroomSetLockUp(0, 0);
    const before = await peg.balanceOf(owner.address);
    await boardroom.exit();
    expect(await peg.balanceOf(owner.address) - before).to.equal(minted - daoAmount - devAmount);
    expect(await share.balanceOf(owner.address)).to.equal(E);
  });
  it("REPRO core: missed epochs can mint multiple times in consecutive blocks", async () => {
    const { peg, treasury, start } = await coreFixture();
    await helpers.time.increaseTo(start + 10n * 21600n);
    const supply = await peg.totalSupply();
    for (let i = 0; i < 5; i++) await treasury.allocateSeigniorage();
    expect(await treasury.epoch()).to.equal(5n);
    expect(await peg.totalSupply()).to.be.greaterThan(supply * 112n / 100n);
    expect(await treasury.nextEpochPoint()).to.be.lessThan(BigInt(await helpers.time.latest()));
  });
  it("REPRO Treasury: stale price remains usable when update fails", async () => {
    const { treasury, oracle, start, peg } = await coreFixture();
    await treasury.setBootstrap(0, 250);
    await oracle.failUpdates();
    await helpers.time.increaseTo(start + 10n * 86400n);
    const supply = await peg.totalSupply();
    await treasury.allocateSeigniorage();
    expect(await peg.totalSupply()).to.be.greaterThan(supply);
  });
  it("REPRO Treasury: setting the expansion limit is overwritten by tier selection", async () => {
    const { treasury, start } = await coreFixture();
    await treasury.setBootstrap(0, 250);
    await treasury.setMaxSupplyExpansionPercents(10);
    await helpers.time.setNextBlockTimestamp(start);
    await treasury.allocateSeigniorage();
    expect(await treasury.maxSupplyExpansionPercent()).to.equal(450n);
  });
  it("PASS PegRedeem: exact 18-decimal redemption transfers PEG to owner and PDAI to user", async () => {
    const [owner, user] = await ethers.getSigners();
    const peg = await ethers.deployContract("contracts/tomb/Peg.sol:Peg");
    const pdai = await ethers.deployContract("TombReviewToken", [18]);
    const redeem = await ethers.deployContract("PegRedeem", [await peg.getAddress(), await pdai.getAddress()]);
    await pdai.mint(owner.address, 10n * E); await pdai.approve(await redeem.getAddress(), 10n * E);
    await redeem.supplyPDAI(10n * E); await peg.mint(user.address, E);
    await peg.connect(user).approve(await redeem.getAddress(), E);
    const before = await peg.balanceOf(owner.address);
    await redeem.connect(user).redeemPEG(E);
    expect(await peg.balanceOf(owner.address) - before).to.equal(E);
    expect(await pdai.balanceOf(user.address)).to.equal(E);
  });
  it("REPRO Share: stated 50,000 maximum omits the initial 1 SHARE", async () => {
    const [owner, dao, dev] = await ethers.getSigners();
    const start = BigInt(await helpers.time.latest()) + 100n;
    const share = await ethers.deployContract("contracts/tomb/Share.sol:Share", [start, dao.address, dev.address]);
    await share.distributeReward(owner.address);
    await helpers.time.increaseTo(start + 300n * 86400n);
    await share.claimRewards();
    expect(await share.totalSupply()).to.be.greaterThan(50000n * E);
    expect(await share.totalSupply()).to.equal(50000999999999994240000n);
  });

  async function rebateFixture() {
    const [owner, user] = await ethers.getSigners();
    const template = await ethers.deployContract("TombScriptUSDC");
    await ethers.provider.send("hardhat_setCode", [USDC, await ethers.provider.getCode(await template.getAddress())]);
    const share = await ethers.deployContract("TombReviewToken", [18]);
    const oracle = await ethers.deployContract("TombReviewPriceOracle", [await share.getAddress(), USDC, 2000000n]);
    const rebates = await ethers.deployContract("RebateTreasury", [await share.getAddress(), await oracle.getAddress(), owner.address]);
    await share.mint(await rebates.getAddress(), 2000n * E);
    return { owner, user, share, oracle, rebates };
  }
  it("REPRO Rebates: emergency withdrawal can remove SHARE already owed to users", async () => {
    const { owner, user, share, rebates } = await rebateFixture();
    const usdc = await ethers.getContractAt("TombScriptUSDC", USDC);
    await usdc.mint(user.address, 100000000n);
    await usdc.connect(user).approve(await rebates.getAddress(), 100000000n);
    await rebates.connect(user).bond(USDC, 100000000n);
    await rebates.emergencyWithdraw(await share.getAddress(), await share.balanceOf(await rebates.getAddress()));
    expect(await rebates.totalVested()).to.equal(ethers.parseEther("53.5"));
    expect(await share.balanceOf(await rebates.getAddress())).to.equal(0n);
    await helpers.time.increase(3 * 86400);
    await expect(rebates.connect(user).claimRewards()).to.revert(ethers);
    expect(await share.balanceOf(owner.address)).to.equal(2000n * E);
  });
  it("REPRO Rebates: live reserve imbalance inflates LP price while TWAP remains unchanged", async () => {
    const { owner, share, rebates } = await rebateFixture();
    const token = await ethers.deployContract("TombReviewToken", [18]);
    const oracle = await ethers.deployContract("TombReviewPriceOracle", [await token.getAddress(), USDC, 2000000n]);
    const pair = await ethers.deployContract("TombReviewPair", [await token.getAddress(), USDC, E, 2000000n]);
    await pair.mintLP(owner.address, E);
    await rebates.setAsset(await pair.getAddress(), true, 1000000n, await oracle.getAddress(), true, await pair.getAddress());
    const before = await rebates.getShareReturn(await pair.getAddress(), E);
    // Same constant product and LP supply; a reserve-changing swap should not
    // inflate a manipulation-resistant LP quote by this magnitude.
    await pair.changeReserves(E / 10n, 20000000n);
    const after = await rebates.getShareReturn(await pair.getAddress(), E);
    expect(after).to.be.greaterThan(before * 5n);
    expect(await share.balanceOf(await rebates.getAddress())).to.equal(2000n * E);
  });
  it("REPRO combined: one-second Oracle update increases USDC rebate rewards", async () => {
    const [owner, user] = await ethers.getSigners();
    const template = await ethers.deployContract("TombScriptUSDC");
    await ethers.provider.send("hardhat_setCode", [USDC, await ethers.provider.getCode(await template.getAddress())]);
    const share = await ethers.deployContract("TombReviewToken", [18]);
    const pair = await ethers.deployContract("TombReviewPair", [await share.getAddress(), USDC, E, 2000000n]);
    const start = BigInt(await helpers.time.latest()) + 10n;
    const oracle = await ethers.deployContract("contracts/tomb/Oracle.sol:Oracle", [await pair.getAddress(), 3600, start]);
    const rebates = await ethers.deployContract("RebateTreasury", [await share.getAddress(), await oracle.getAddress(), owner.address]);
    await share.mint(await rebates.getAddress(), 2000n * E);
    const usdc = await ethers.getContractAt("TombScriptUSDC", USDC);
    await usdc.mint(user.address, 100000000n);
    await usdc.connect(user).approve(await rebates.getAddress(), 100000000n);
    await helpers.time.setNextBlockTimestamp(start + 3598n);
    await pair.changeReserves(E, 1000000n);
    await helpers.time.setNextBlockTimestamp(start + 3599n);
    await oracle.connect(user).update();
    const before = await rebates.getShareReturn(USDC, 100000000n);
    await helpers.time.setNextBlockTimestamp(start + 3600n);
    await oracle.connect(user).update();
    const after = await rebates.getShareReturn(USDC, 100000000n);
    expect(after).to.be.greaterThan(before * 19n / 10n);
    await rebates.connect(user).bond(USDC, 100000000n);
    expect(await rebates.totalVested()).to.equal(after);
  });
  it("REPRO Genesis: PEG staking can spend principal as rewards when unfunded", async () => {
    const [owner, user] = await ethers.getSigners();
    const peg = await ethers.deployContract("contracts/tomb/Peg.sol:Peg");
    const start = BigInt(await helpers.time.latest()) + 100n;
    const genesis = await ethers.deployContract("GenesisRewardPool", [await peg.getAddress(), start]);
    await genesis.add(1, await peg.getAddress(), true, 0, 0);
    await peg.mint(user.address, E);
    await peg.connect(user).approve(await genesis.getAddress(), E);
    await genesis.connect(user).deposit(0, E);
    await helpers.time.setNextBlockTimestamp(start + 100n);
    await genesis.connect(user).deposit(0, 0);
    expect(await peg.balanceOf(await genesis.getAddress())).to.equal(0n);
    expect((await genesis.userInfo(0, user.address)).amount).to.equal(E);
    await expect(genesis.connect(user).withdraw(0, E)).to.revert(ethers);
    expect(await peg.balanceOf(owner.address)).to.equal(E);
  });
});

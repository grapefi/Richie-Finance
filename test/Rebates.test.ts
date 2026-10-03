import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();
const USDC = "0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07";
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

describe("RebateTreasury bridged USDC", () => {
  async function fixture() {
    const [owner, user] = await ethers.getSigners();
    const template = await ethers.deployContract("TombScriptUSDC");
    await ethers.provider.send("hardhat_setCode", [USDC, await ethers.provider.getCode(await template.getAddress())]);
    const usdc = await ethers.getContractAt("TombScriptUSDC", USDC);
    const share = await ethers.deployContract("TombScriptToken");
    const oracle = await ethers.deployContract("TombScriptRebateOracle", [await share.getAddress(), USDC]);
    const rebates = await ethers.deployContract("RebateTreasury", [await share.getAddress(), await oracle.getAddress(), owner.address]);
    await share.mint(await rebates.getAddress(), ethers.parseEther("1000"));
    await usdc.mint(user.address, 1000000000n);
    await usdc.connect(user).approve(await rebates.getAddress(), ethers.MaxUint256);
    return { owner, user, usdc, share, oracle, rebates };
  }

  it("turns 100 USDC into 53.5 vested SHARE at 2 USDC/SHARE and 7% bonus", async () => {
    const { user, usdc, share, rebates } = await networkHelpers.loadFixture(fixture);
    expect(await rebates.getSharePrice()).to.equal(2000000n);
    expect(await rebates.getShareReturn(USDC, 100000000n)).to.equal(ethers.parseEther("53.5"));
    await rebates.connect(user).bond(USDC, 100000000n);
    expect(await usdc.balanceOf(await rebates.getAddress())).to.equal(100000000n);
    expect(await rebates.totalVested()).to.equal(ethers.parseEther("53.5"));
    await networkHelpers.time.increase(3 * 86400);
    await rebates.connect(user).claimRewards();
    expect(await share.balanceOf(user.address)).to.equal(ethers.parseEther("53.5"));
    expect(await rebates.totalVested()).to.equal(0n);
  });

  it("handles 6-decimal minimum deposits and pays rounding dust at the end", async () => {
    const { user, share, oracle, rebates } = await networkHelpers.loadFixture(fixture);
    await oracle.setPrice(3000000n);
    const reward = await rebates.getShareReturn(USDC, 1n);
    expect(reward).to.equal(356666666666n);
    await rebates.connect(user).bond(USDC, 1n);
    await networkHelpers.time.increase(12345);
    await rebates.connect(user).claimRewards();
    await networkHelpers.time.increase(12345);
    await rebates.connect(user).claimRewards();
    await networkHelpers.time.increase(3 * 86400);
    expect(await rebates.claimableShares(user.address)).to.equal(reward - await share.balanceOf(user.address));
    await rebates.connect(user).claimRewards();
    expect(await share.balanceOf(user.address)).to.equal(reward);
    expect(await rebates.totalVested()).to.equal(0n);
  });

  it("rejects zero/stale prices and non-USDC quote oracles", async () => {
    const { owner, user, share, oracle, rebates } = await networkHelpers.loadFixture(fixture);
    await oracle.setPrice(0n);
    await expect(rebates.connect(user).bond(USDC, 1000000n)).to.be.revertedWith("RebateTreasury: zero share price");
    await oracle.setPrice(2000000n);
    await networkHelpers.time.increase(86401);
    await expect(rebates.connect(user).bond(USDC, 1000000n)).to.be.revertedWith("RebateTreasury: stale share oracle");
    const wrong = await ethers.deployContract("TombScriptRebateOracle", [await share.getAddress(), owner.address]);
    await expect(rebates.setShareOracle(await wrong.getAddress())).to.be.revertedWith("RebateTreasury: oracle must be SHARE/USDC");
  });

  it("does not overcommit SHARE or accept a fake USDC copy", async () => {
    const { user, rebates } = await networkHelpers.loadFixture(fixture);
    await expect(rebates.connect(user).bond(USDC, 100000000000n)).to.be.revertedWith("RebateTreasury: insufficient share balance");
    const forkedUSDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    await expect(rebates.connect(user).bond(forkedUSDC, 1000000n)).to.be.revertedWith("RebateTreasury: token is not a bondable asset");
    await expect(rebates.setAsset(USDC, true, 1000000n, user.address, false, ethers.ZeroAddress)).to.be.revertedWith("RebateTreasury: direct USDC only");
  });

  async function plsFixture() {
    const base = await fixture();
    const template = await ethers.deployContract("TombScriptToken");
    await ethers.provider.send("hardhat_setCode", [WPLS, await ethers.provider.getCode(await template.getAddress())]);
    const plsOracle = await ethers.deployContract("TombScriptRebateOracle", [WPLS, USDC]);
    await plsOracle.setPrice(100n); // 0.0001 USDC per PLS, in raw six-decimal units.
    await base.rebates.setAsset(WPLS, true, 1000000n, await plsOracle.getAddress(), false, ethers.ZeroAddress);
    return { ...base, plsOracle };
  }

  it("accepts native PLS, retains native funds, and vests the correctly scaled SHARE", async () => {
    const { user, share, rebates } = await networkHelpers.loadFixture(plsFixture);
    const amount = ethers.parseEther("100");
    const reward = ethers.parseEther("0.00535");
    expect(await rebates.getShareReturn(WPLS, amount)).to.equal(reward);
    await expect(rebates.connect(user).bondPLS(reward, { value: amount }))
      .to.emit(rebates, "Bonded").withArgs(user.address, ethers.ZeroAddress, amount, reward);
    expect(await ethers.provider.getBalance(await rebates.getAddress())).to.equal(amount);
    expect(await rebates.totalVested()).to.equal(reward);
    await networkHelpers.time.increase(3 * 86400);
    await rebates.connect(user).claimRewards();
    expect(await share.balanceOf(user.address)).to.equal(reward);
    expect(await rebates.totalVested()).to.equal(0n);
  });

  it("rejects zero, rounded-to-zero, minimum-return, and disabled PLS deposits", async () => {
    const { user, plsOracle, rebates } = await networkHelpers.loadFixture(plsFixture);
    await expect(rebates.connect(user).bondPLS(0)).to.be.revertedWith("RebateTreasury: invalid bond amount");
    await expect(rebates.connect(user).bondPLS(0, { value: 1n })).to.be.revertedWith("RebateTreasury: zero share return");
    await expect(rebates.connect(user).bondPLS(ethers.parseEther("1"), { value: ethers.parseEther("100") })).to.be.revertedWith("RebateTreasury: minimum share return");
    expect(await ethers.provider.getBalance(await rebates.getAddress())).to.equal(0n);
    await rebates.setAsset(WPLS, false, 1000000n, await plsOracle.getAddress(), false, ethers.ZeroAddress);
    await expect(rebates.connect(user).bondPLS(0, { value: ethers.parseEther("1") })).to.be.revertedWith("RebateTreasury: token is not a bondable asset");
  });

  it("rejects stale/zero PLS prices and wrong quote currencies", async () => {
    const { user, owner, oracle, plsOracle, rebates } = await networkHelpers.loadFixture(plsFixture);
    await plsOracle.setPrice(0);
    await expect(rebates.connect(user).bondPLS(0, { value: ethers.parseEther("1") })).to.be.revertedWith("RebateTreasury: zero PLS price");
    await plsOracle.setPrice(100);
    await networkHelpers.time.increase(86401);
    await oracle.update();
    await expect(rebates.connect(user).bondPLS(0, { value: ethers.parseEther("1") })).to.be.revertedWith("RebateTreasury: stale asset oracle");
    const wrong = await ethers.deployContract("TombScriptRebateOracle", [WPLS, owner.address]);
    await expect(rebates.setAsset(WPLS, true, 1000000n, await wrong.getAddress(), false, ethers.ZeroAddress)).to.be.revertedWith("RebateTreasury: asset oracle must quote USDC");
  });

  it("combines USDC and PLS vesting without losing or duplicating rewards", async () => {
    const { user, share, oracle, plsOracle, rebates } = await networkHelpers.loadFixture(plsFixture);
    const usdcReward = ethers.parseEther("53.5");
    const plsReward = ethers.parseEther("0.00535");
    await rebates.connect(user).bond(USDC, 100000000n);
    await networkHelpers.time.increase(86400);
    await oracle.update();
    await plsOracle.update();
    await rebates.connect(user).bondPLS(plsReward, { value: ethers.parseEther("100") });
    const paid = await share.balanceOf(user.address);
    expect(paid).to.be.greaterThan(0n);
    expect(await rebates.totalVested()).to.equal(usdcReward + plsReward - paid);
    await networkHelpers.time.increase(3 * 86400);
    await rebates.connect(user).claimRewards();
    expect(await share.balanceOf(user.address)).to.equal(usdcReward + plsReward);
    expect(await rebates.totalVested()).to.equal(0n);
  });

  it("allows only the owner to recover PLS without changing SHARE liabilities", async () => {
    const { user, rebates } = await networkHelpers.loadFixture(plsFixture);
    await rebates.connect(user).bondPLS(0, { value: ethers.parseEther("100") });
    const liability = await rebates.totalVested();
    await expect(rebates.connect(user).withdrawPLS(1)).to.revert(ethers);
    await rebates.withdrawPLS(ethers.parseEther("40"));
    expect(await ethers.provider.getBalance(await rebates.getAddress())).to.equal(ethers.parseEther("60"));
    expect(await rebates.totalVested()).to.equal(liability);
    await expect(user.sendTransaction({ to: await rebates.getAddress(), value: 1n })).to.revert(ethers);
  });
});

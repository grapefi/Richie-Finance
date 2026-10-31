import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();
const DAI = "0xefd766ccb38eaf1dfd701853bfce31359239f305";
const PDAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

describe("RebateTreasury official DAI quotes", () => {
  async function fixture() {
    const [owner, user] = await ethers.getSigners();
    const template = await ethers.deployContract("TombScriptToken");
    await ethers.provider.send("hardhat_setCode", [DAI, await ethers.provider.getCode(await template.getAddress())]);
    const dai = await ethers.getContractAt("TombScriptToken", DAI);
    const share = await ethers.deployContract("TombScriptToken");
    const oracle = await ethers.deployContract("TombScriptRebateOracle", [await share.getAddress(), DAI]);
    const rebates = await ethers.deployContract("RebateTreasury", [await share.getAddress(), await oracle.getAddress(), owner.address]);
    await share.mint(await rebates.getAddress(), ethers.parseEther("1000"));
    await dai.mint(user.address, ethers.parseEther("1000"));
    await dai.connect(user).approve(await rebates.getAddress(), ethers.MaxUint256);
    return { owner, user, dai, share, oracle, rebates };
  }

  it("turns 100 DAI into 53.5 vested SHARE at 2 DAI/SHARE and a 7% bonus", async () => {
    const { user, dai, share, rebates } = await networkHelpers.loadFixture(fixture);
    expect(await rebates.getSharePrice()).to.equal(ethers.parseEther("2"));
    expect(await rebates.getShareReturn(DAI, ethers.parseEther("100"))).to.equal(ethers.parseEther("53.5"));
    await rebates.connect(user).bond(DAI, ethers.parseEther("100"));
    expect(await dai.balanceOf(await rebates.getAddress())).to.equal(ethers.parseEther("100"));
    expect(await rebates.totalVested()).to.equal(ethers.parseEther("53.5"));
    await networkHelpers.time.increase(3 * 86400);
    await rebates.connect(user).claimRewards();
    expect(await share.balanceOf(user.address)).to.equal(ethers.parseEther("53.5"));
    expect(await rebates.totalVested()).to.equal(0n);
  });

  it("pays linear vesting rounding dust at the end", async () => {
    const { user, share, oracle, rebates } = await networkHelpers.loadFixture(fixture);
    await oracle.setPrice(ethers.parseEther("3"));
    const amount = ethers.parseEther("3");
    const reward = await rebates.getShareReturn(DAI, amount);
    expect(reward).to.equal(ethers.parseEther("1.07"));
    await rebates.connect(user).bond(DAI, amount);
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

  it("rejects zero/stale prices and non-DAI quote oracles", async () => {
    const { owner, user, share, oracle, rebates } = await networkHelpers.loadFixture(fixture);
    await oracle.setPrice(0n);
    await expect(rebates.connect(user).bond(DAI, ethers.parseEther("1"))).to.be.revertedWith("RebateTreasury: zero share price");
    await oracle.setPrice(ethers.parseEther("2"));
    await networkHelpers.time.increase(86401);
    await expect(rebates.connect(user).bond(DAI, ethers.parseEther("1"))).to.be.revertedWith("RebateTreasury: stale share oracle");
    const wrong = await ethers.deployContract("TombScriptRebateOracle", [await share.getAddress(), owner.address]);
    await expect(rebates.setShareOracle(await wrong.getAddress())).to.be.revertedWith("RebateTreasury: oracle must be SHARE/DAI");
  });

  it("does not overcommit SHARE or silently treat a different token as DAI", async () => {
    const { user, rebates } = await networkHelpers.loadFixture(fixture);
    await expect(rebates.connect(user).bond(DAI, ethers.parseEther("100000"))).to.be.revertedWith("RebateTreasury: insufficient share balance");
    const other = "0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07";
    await expect(rebates.connect(user).bond(other, ethers.parseEther("1"))).to.be.revertedWith("RebateTreasury: token is not a bondable asset");
    await expect(rebates.setAsset(DAI, true, 1000000n, user.address)).to.be.revertedWith("RebateTreasury: direct DAI only");
  });

  it("accepts configured pDAI and normalizes configured token decimals", async () => {
    const { user, share, rebates } = await networkHelpers.loadFixture(fixture);
    const pdaiTemplate = await ethers.deployContract("TombScriptToken");
    await ethers.provider.send("hardhat_setCode", [PDAI, await ethers.provider.getCode(await pdaiTemplate.getAddress())]);
    const pdai = await ethers.getContractAt("TombScriptToken", PDAI);
    const pdaiOracle = await ethers.deployContract("TombScriptRebateOracle", [PDAI, DAI]);
    await pdaiOracle.setPrice(ethers.parseEther("1"));
    await rebates.setAsset(PDAI, true, 1000000n, await pdaiOracle.getAddress());
    await pdai.mint(user.address, ethers.parseEther("100"));
    await pdai.connect(user).approve(await rebates.getAddress(), ethers.MaxUint256);
    expect(await rebates.getShareReturn(PDAI, ethers.parseEther("100"))).to.equal(ethers.parseEther("53.5"));

    const token8 = await ethers.deployContract("TombScriptToken8");
    const token8Oracle = await ethers.deployContract("TombScriptRebateOracle", [await token8.getAddress(), DAI]);
    await token8Oracle.setPrice(ethers.parseEther("2"));
    await rebates.setAsset(await token8.getAddress(), true, 1000000n, await token8Oracle.getAddress());
    await token8.mint(user.address, 100n * 10n ** 8n);
    await token8.connect(user).approve(await rebates.getAddress(), ethers.MaxUint256);
    expect(await rebates.getShareReturn(await token8.getAddress(), 100n * 10n ** 8n)).to.equal(ethers.parseEther("107"));
    expect(await share.decimals()).to.equal(18n);
  });

  it("rejects V2 LP assets and caps the configured discount at 50%", async () => {
    const { owner, share, rebates } = await networkHelpers.loadFixture(fixture);
    const pair = await ethers.deployContract("TombScriptPair", [await share.getAddress(), DAI]);
    const pairOracle = await ethers.deployContract("TombScriptRebateOracle", [await pair.getAddress(), DAI]);
    await expect(rebates.setAsset(await pair.getAddress(), true, 1000000n, await pairOracle.getAddress()))
      .to.be.revertedWith("RebateTreasury: LP assets are not supported");
    expect(await rebates.MAX_DISCOUNT()).to.equal(500000n);
    await expect(rebates.setBondParameters(500001n, 3 * 86400)).to.be.revertedWith("RebateTreasury: discount too high");
    await rebates.setBondParameters(500000n, 3 * 86400);
    expect(await rebates.discount()).to.equal(500000n);
    expect(owner.address).to.not.equal(ethers.ZeroAddress);
  });

  it("allows the owner to withdraw only SHARE above outstanding vesting liabilities", async () => {
    const { owner, user, share, rebates } = await networkHelpers.loadFixture(fixture);
    await rebates.connect(user).bond(DAI, ethers.parseEther("100"));
    const liability = await rebates.totalVested();
    const balance = await share.balanceOf(await rebates.getAddress());
    const surplus = balance - liability;
    await rebates.emergencyWithdraw(await share.getAddress(), surplus);
    expect(await share.balanceOf(await rebates.getAddress())).to.equal(liability);
    await expect(rebates.emergencyWithdraw(await share.getAddress(), 1n)).to.be.revertedWith("RebateTreasury: Share reserved for vesting");
    await networkHelpers.time.increase(3 * 86400);
    await rebates.connect(user).claimRewards();
    expect(await share.balanceOf(user.address)).to.equal(liability);
    expect(await share.balanceOf(owner.address)).to.equal(surplus);
  });

  async function plsFixture() {
    const base = await fixture();
    const template = await ethers.deployContract("TombScriptToken");
    await ethers.provider.send("hardhat_setCode", [WPLS, await ethers.provider.getCode(await template.getAddress())]);
    const plsOracle = await ethers.deployContract("TombScriptRebateOracle", [WPLS, DAI]);
    await plsOracle.setPrice(10n ** 14n); // 0.0001 DAI per PLS, both with 18 decimals.
    await base.rebates.setAsset(WPLS, true, 1000000n, await plsOracle.getAddress());
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
    await rebates.setAsset(WPLS, false, 1000000n, await plsOracle.getAddress());
    await expect(rebates.connect(user).bondPLS(0, { value: ethers.parseEther("1") })).to.be.revertedWith("RebateTreasury: token is not a bondable asset");
  });

  it("rejects stale/zero PLS prices and wrong quote currencies", async () => {
    const { user, owner, oracle, plsOracle, rebates } = await networkHelpers.loadFixture(plsFixture);
    await plsOracle.setPrice(0);
    await expect(rebates.connect(user).bondPLS(0, { value: ethers.parseEther("1") })).to.be.revertedWith("RebateTreasury: zero token price");
    await plsOracle.setPrice(10n ** 14n);
    await networkHelpers.time.increase(86401);
    await oracle.update();
    await expect(rebates.connect(user).bondPLS(0, { value: ethers.parseEther("1") })).to.be.revertedWith("RebateTreasury: stale asset oracle");
    const wrong = await ethers.deployContract("TombScriptRebateOracle", [WPLS, owner.address]);
    await expect(rebates.setAsset(WPLS, true, 1000000n, await wrong.getAddress())).to.be.revertedWith("RebateTreasury: asset oracle must quote DAI");
  });

  it("combines DAI and PLS vesting without losing or duplicating rewards", async () => {
    const { user, share, oracle, plsOracle, rebates } = await networkHelpers.loadFixture(plsFixture);
    const daiReward = ethers.parseEther("53.5");
    const plsReward = ethers.parseEther("0.00535");
    await rebates.connect(user).bond(DAI, ethers.parseEther("100"));
    await networkHelpers.time.increase(86400);
    await oracle.update();
    await plsOracle.update();
    await rebates.connect(user).bondPLS(plsReward, { value: ethers.parseEther("100") });
    const paid = await share.balanceOf(user.address);
    expect(paid).to.be.greaterThan(0n);
    expect(await rebates.totalVested()).to.equal(daiReward + plsReward - paid);
    await networkHelpers.time.increase(3 * 86400);
    await rebates.connect(user).claimRewards();
    expect(await share.balanceOf(user.address)).to.equal(daiReward + plsReward);
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

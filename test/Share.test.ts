import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();

describe("Share.sol consolidated treasury allocation", () => {
  it("vests exactly 10,000 RICH and caps intended issuance at 50,001 RICH", async () => {
    const [deployer, treasury, farm] = await ethers.getSigners();
    const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = BigInt(latest) + 100n;
    const share = await ethers.deployContract("contracts/tomb/Share.sol:Share", [
      start,
      treasury.address,
    ]);

    expect(await share.balanceOf(deployer.address)).to.equal(ethers.parseEther("1"));
    expect(await share.FARMING_POOL_REWARD_ALLOCATION()).to.equal(ethers.parseEther("40000"));
    expect(await share.COMMUNITY_FUND_POOL_ALLOCATION()).to.equal(ethers.parseEther("10000"));
    expect(await share.unclaimedTreasuryFund()).to.equal(0n);

    await networkHelpers.time.increaseTo(start + (150n * 86400n));
    await share.claimRewards();
    expect(await share.balanceOf(treasury.address)).to.equal(ethers.parseEther("10000"));

    await share.distributeReward(farm.address);
    expect(await share.balanceOf(farm.address)).to.equal(ethers.parseEther("40000"));
    expect(await share.totalSupply()).to.equal(ethers.parseEther("50001"));

    await share.claimRewards();
    await expect(share.distributeReward(farm.address)).to.be.revertedWith(
      "only can distribute once",
    );
    expect(await share.totalSupply()).to.equal(ethers.parseEther("50001"));
  });

  it("allows only the current fund to rotate to a nonzero replacement", async () => {
    const [, treasury, replacement, outsider] = await ethers.getSigners();
    const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = BigInt(latest) + 100n;
    const share = await ethers.deployContract("contracts/tomb/Share.sol:Share", [
      start,
      treasury.address,
    ]);

    await expect(
      share.connect(outsider).setTreasuryFund(replacement.address),
    ).to.be.revertedWith("!dao");
    await expect(
      share.connect(treasury).setTreasuryFund(ethers.ZeroAddress),
    ).to.be.revertedWith("zero fund");
    await expect(
      share.connect(treasury).setTreasuryFund(replacement.address),
    )
      .to.emit(share, "TreasuryFundChanged")
      .withArgs(treasury.address, replacement.address);
    expect(await share.communityFund()).to.equal(replacement.address);

    await networkHelpers.time.increaseTo(start + 86400n);
    await share.claimRewards();
    expect(await share.balanceOf(treasury.address)).to.equal(0n);
    expect(await share.balanceOf(replacement.address)).to.be.greaterThan(0n);
  });

  it("rejects a zero treasury fund at deployment", async () => {
    const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
    await expect(
      ethers.deployContract("contracts/tomb/Share.sol:Share", [
        BigInt(latest) + 100n,
        ethers.ZeroAddress,
      ]),
    ).to.be.revertedWith("Address cannot be 0");
  });
});

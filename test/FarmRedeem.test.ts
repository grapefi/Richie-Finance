import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("Farm emissions and PEG redemption", () => {
  it("emits exactly 40,000 RICH pro rata over 365 days", async () => {
    const [owner, feeRecipient] = await ethers.getSigners();
    const rich = await ethers.deployContract("TombScriptToken");
    const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
    const start = BigInt(latest) + 3600n;
    const duration = 365n * 86400n;
    const farm = await ethers.deployContract("ShareRewardPool", [
      await rich.getAddress(),
      start,
      feeRecipient.address,
    ]);

    expect(await farm.operator()).to.equal(owner.address);
    expect(await farm.psmFeeRecipient()).to.equal(feeRecipient.address);
    expect(await farm.MAX_PSM_FEE_BPS()).to.equal(5000n);
    expect(await farm.pegStabilityModuleFee()).to.equal(3000n);
    expect(await farm.runningTime()).to.equal(duration);
    expect(await farm.poolEndTime()).to.equal(start + duration);
    expect(await farm.TOTAL_REWARDS()).to.equal(ethers.parseEther("40000"));
    expect(await farm.getGeneratedReward(start, start + duration)).to.equal(
      ethers.parseEther("40000"),
    );

    const halfway = start + duration / 2n;
    expect(await farm.getGeneratedReward(start, halfway)).to.equal(
      ethers.parseEther("20000"),
    );
    expect(await farm.getGeneratedReward(halfway, start + duration)).to.equal(
      ethers.parseEther("20000"),
    );
    expect(await farm.getGeneratedReward(0, start)).to.equal(0n);
    expect(await farm.getGeneratedReward(start + duration, start + duration + 1n)).to.equal(0n);
    await expect(farm.setPegStabilityModuleFee(5001n)).to.be.revertedWith(
      "ShareRewardPool: PSM fee too high",
    );
    await farm.setPegStabilityModuleFee(5000n);
    expect(await farm.pegStabilityModuleFee()).to.equal(5000n);
  });

  it("requires an explicit nonzero PSM fee recipient", async () => {
    const rich = await ethers.deployContract("TombScriptToken");
    const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
    await expect(
      ethers.deployContract("ShareRewardPool", [
        await rich.getAddress(),
        BigInt(latest) + 3600n,
        ethers.ZeroAddress,
      ]),
    ).to.be.revertedWith("ShareRewardPool: zero fee recipient");
  });

  it("sends redeemed CASH to the configured recipient and PDAI to the user", async () => {
    const [owner, user, cashRecipient] = await ethers.getSigners();
    const cash = await ethers.deployContract("TombScriptToken");
    const pdai = await ethers.deployContract("TombScriptToken");
    await expect(
      ethers.deployContract("PegRedeem", [
        await cash.getAddress(),
        await pdai.getAddress(),
        ethers.ZeroAddress,
      ]),
    ).to.be.revertedWith("PegRedeem: invalid recipient");
    const redeem = await ethers.deployContract("PegRedeem", [
      await cash.getAddress(),
      await pdai.getAddress(),
      cashRecipient.address,
    ]);

    await cash.mint(user.address, ethers.parseEther("10"));
    await pdai.mint(owner.address, ethers.parseEther("20"));
    await pdai.approve(await redeem.getAddress(), ethers.MaxUint256);
    await redeem.supplyPDAI(ethers.parseEther("20"));
    await cash.connect(user).approve(await redeem.getAddress(), ethers.MaxUint256);

    await redeem.connect(user).redeemPEG(ethers.parseEther("5"));
    expect(await cash.balanceOf(cashRecipient.address)).to.equal(ethers.parseEther("5"));
    expect(await pdai.balanceOf(user.address)).to.equal(ethers.parseEther("5"));
    expect(await pdai.balanceOf(await redeem.getAddress())).to.equal(ethers.parseEther("15"));
  });

  it("retrieves PDAI only to an explicit nonzero recipient", async () => {
    const [owner, user, cashRecipient, reserveRecipient] = await ethers.getSigners();
    const cash = await ethers.deployContract("TombScriptToken");
    const pdai = await ethers.deployContract("TombScriptToken");
    const redeem = await ethers.deployContract("PegRedeem", [
      await cash.getAddress(),
      await pdai.getAddress(),
      cashRecipient.address,
    ]);

    await pdai.mint(owner.address, ethers.parseEther("10"));
    await pdai.approve(await redeem.getAddress(), ethers.MaxUint256);
    await redeem.supplyPDAI(ethers.parseEther("10"));
    await expect(
      redeem.retrievePDAI(ethers.parseEther("1"), ethers.ZeroAddress),
    ).to.be.revertedWith("PegRedeem: zero fee recipient");
    await expect(
      redeem.connect(user).retrievePDAI(ethers.parseEther("1"), reserveRecipient.address),
    ).to.be.revertedWithCustomError(redeem, "OwnableUnauthorizedAccount");

    await redeem.retrievePDAI(ethers.parseEther("3"), reserveRecipient.address);
    expect(await pdai.balanceOf(reserveRecipient.address)).to.equal(ethers.parseEther("3"));
    expect(await pdai.balanceOf(await redeem.getAddress())).to.equal(ethers.parseEther("7"));
  });
});

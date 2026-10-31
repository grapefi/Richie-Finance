import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();

describe("Treasury expansion tiers", () => {
  it("uses only the configured supply and expansion tier arrays", async () => {
    const [owner, peg, share, oracle, boardroom] = await ethers.getSigners();
    const treasury = await ethers.deployContract("Treasury");
    const start = BigInt(await networkHelpers.time.latest()) + 1000n;
    await treasury.initialize(peg.address, share.address, oracle.address, boardroom.address, start);

    expect(await treasury.supplyTiers(0)).to.equal(0n);
    expect(await treasury.supplyTiers(1)).to.equal(ethers.parseEther("100000000"));
    expect(await treasury.supplyTiers(2)).to.equal(ethers.parseEther("250000000"));
    expect(await treasury.supplyTiers(3)).to.equal(ethers.parseEther("500000000"));

    expect(await treasury.maxExpansionTiers(0)).to.equal(200n);
    expect(await treasury.maxExpansionTiers(1)).to.equal(100n);
    expect(await treasury.maxExpansionTiers(2)).to.equal(50n);
    expect(await treasury.maxExpansionTiers(3)).to.equal(25n);

    expect(treasury.interface.hasFunction("maxSupplyExpansionPercent()"))
      .to.equal(false);
    expect(treasury.interface.hasFunction("setMaxSupplyExpansionPercents(uint256)"))
      .to.equal(false);

    await treasury.connect(owner).setMaxExpansionTiersEntry(0, 175);
    expect(await treasury.maxExpansionTiers(0)).to.equal(175n);
  });
});

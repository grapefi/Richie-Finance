import { expect } from "chai";
import { network } from "hardhat";
import { main, validatePair } from "../scripts/tomb/deploy-zap.js";

const { ethers, networkHelpers } = await network.connect();
const FACTORY = "0x29eA7545DEf87022BAdc76323F373EA1e707C523";
const ROUTER = "0x165C3410fC91EF562C50559f7d2289fEbed552d9";
const PDAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

async function fixture() {
  const [signer] = await ethers.getSigners();
  const peg = await ethers.deployContract("TombScriptToken");
  const share = await ethers.deployContract("TombScriptToken");
  const pegPair = await ethers.deployContract("TombScriptPair", [PDAI, await peg.getAddress()]);
  const sharePair = await ethers.deployContract("TombScriptPair", [WPLS, await share.getAddress()]);
  for (const [name, address] of [["TombScriptFactory", FACTORY], ["TombScriptRouter", ROUTER]]) {
    const mock = await ethers.deployContract(name);
    await ethers.provider.send("hardhat_setCode", [address, await ethers.provider.getCode(await mock.getAddress())]);
  }
  const factory = await ethers.getContractAt("TombScriptFactory", FACTORY);
  await factory.setPair(await peg.getAddress(), PDAI, await pegPair.getAddress());
  await factory.setPair(await share.getAddress(), WPLS, await sharePair.getAddress());
  return { ctx: { ethers, signer }, peg, share, pegPair, sharePair, factory };
}

describe("Dual PulseX zap deployment", () => {
  it("deploys both with correct token/quote/LP and preserves PEG getters", async () => {
    const { ctx, peg, share, pegPair, sharePair } = await networkHelpers.loadFixture(fixture);
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { TOMB_PEG_ADDRESS: await peg.getAddress(), TOMB_SHARE_ADDRESS: await share.getAddress(), TOMB_PEG_PDAI_PAIR_ADDRESS: await pegPair.getAddress(), TOMB_SHARE_PAIR_ADDRESS: await sharePair.getAddress() });
      const { pegZap, shareZap } = await main(ctx);
      expect(await pegZap.PEG()).to.equal(await peg.getAddress());
      expect(await pegZap.PEG_PDAI_LP()).to.equal(await pegPair.getAddress());
      expect(await pegZap.QUOTE()).to.equal(PDAI);
      expect(await shareZap.SHARE()).to.equal(await share.getAddress());
      expect(await shareZap.SHARE_WPLS_LP()).to.equal(await sharePair.getAddress());
      expect(await shareZap.QUOTE()).to.equal(WPLS);
      expect(await shareZap.owner()).to.equal(ctx.signer.address);
      await expect(shareZap.zapInToken(PDAI, 10n, 0n, 0n, 0n, 2n ** 255n)).to.be.revertedWith("PegPdaiZap: unsupported token");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
  it("rejects token addresses, empty pools, and unregistered pairs before deployment", async () => {
    const { ctx, peg, pegPair, factory } = await networkHelpers.loadFixture(fixture);
    const token = await peg.getAddress();
    await expect(validatePair(ctx, token, token, PDAI, "PEG pair")).to.be.rejectedWith("LP address");
    await pegPair.setReserves(0n, 1n);
    await expect(validatePair(ctx, await pegPair.getAddress(), token, PDAI, "PEG pair")).to.be.rejectedWith("needs liquidity");
    await factory.setPair(token, PDAI, ethers.ZeroAddress);
    await expect(validatePair(ctx, await pegPair.getAddress(), token, PDAI, "PEG pair")).to.be.rejectedWith("registered PulseX V2");
    await expect(ethers.deployContract("contracts/tomb/Zap.sol:PegPdaiZap", [token, await pegPair.getAddress()])).to.be.revertedWith("Zap: unregistered PulseX V2 pair");
  });
});

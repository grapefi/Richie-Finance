import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();

describe("Peg.sol", () => {
    async function deployContracts() {
        const [operator, receiver, outsider] = await ethers.getSigners();
        const peg = await ethers.deployContract("Peg", [], operator);
        await peg.waitForDeployment();

        return { peg, operator, receiver, outsider };
    }

    describe("access control", () => {
        it("rejects non-operators for operator-only methods", async () => {
            const { peg, operator, outsider } = await networkHelpers.loadFixture(deployContracts);
            const unauthorizedPeg = peg.connect(outsider);
            const reason = "operator: caller is not the operator";

            await expect(unauthorizedPeg.mint(outsider.address, 1000n))
                .to.be.revertedWith(reason);
            await expect(unauthorizedPeg.burnFrom(operator.address, 1000n))
                .to.be.revertedWith(reason);
            await expect(unauthorizedPeg.distributeReward(outsider.address))
                .to.be.revertedWith(reason);
            await expect(
                unauthorizedPeg.governanceRecoverUnsupported(
                    await peg.getAddress(),
                    1000n,
                    outsider.address,
                ),
            ).to.be.revertedWith(reason);
        });
    });

    describe("mint", () => {
        it("mints PEG when called by the operator", async () => {
            const { peg, operator, receiver } = await networkHelpers.loadFixture(deployContracts);
            const amount = 239n;

            expect(await peg.operator()).to.equal(operator.address);
            await expect(peg.connect(operator).mint(receiver.address, amount))
                .to.emit(peg, "Transfer")
                .withArgs(ethers.ZeroAddress, receiver.address, amount);

            expect(await peg.balanceOf(receiver.address)).to.equal(amount);
            expect(await peg.totalSupply()).to.equal(ethers.parseEther("1") + amount);
        });
    });

    describe("distribute reward", () => {
        it("distributes 2400 PEG once when called by the operator", async () => {
            const { peg, operator, receiver } = await networkHelpers.loadFixture(deployContracts);
            const amount = ethers.parseEther("2400");

            expect(await peg.rewardPoolDistributed()).to.equal(false);
            await expect(peg.connect(operator).distributeReward(receiver.address))
                .to.emit(peg, "Transfer")
                .withArgs(ethers.ZeroAddress, receiver.address, amount);

            expect(await peg.balanceOf(receiver.address)).to.equal(amount);
            expect(await peg.totalSupply()).to.equal(ethers.parseEther("1") + amount);
            expect(await peg.rewardPoolDistributed()).to.equal(true);

            await expect(peg.connect(operator).distributeReward(receiver.address))
                .to.be.revertedWith("only can distribute once");
            expect(await peg.balanceOf(receiver.address)).to.equal(amount);
            expect(await peg.totalSupply()).to.equal(ethers.parseEther("1") + amount);
        });
    });
});

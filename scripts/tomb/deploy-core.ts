import {Contract, getAddress, isAddress} from "ethers";
import {network} from "hardhat";

function requiredAddress(name: string): string {
  const value = process.env[name];
  if (!value || !isAddress(value)) {
    throw new Error(`${name} must be a valid address`);
  }
  return getAddress(value);
}

function requiredTimestamp(name: string): bigint {
  const value = process.env[name];
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a Unix timestamp`);
  }
  return BigInt(value);
}

async function main() {
  const {ethers} = await network.connect();
  const [deployer] = await ethers.getSigners();

  const peg = requiredAddress("TOMB_PEG_ADDRESS");
  const share = requiredAddress("TOMB_SHARE_ADDRESS");
  const oracle = requiredAddress("TOMB_ORACLE_ADDRESS");
  const startTime = requiredTimestamp("TOMB_TREASURY_START_TIME");

  console.log("Deployer:", deployer.address);

  const Boardroom = await ethers.getContractFactory(
    "contracts/tomb/Boardroom.sol:Boardroom",
  );
  const boardroom = await Boardroom.deploy();
  await boardroom.waitForDeployment();
  const boardroomAddress = await boardroom.getAddress();
  console.log("Boardroom:", boardroomAddress);

  const Treasury = await ethers.getContractFactory(
    "contracts/tomb/Treasury.sol:Treasury",
  );
  const treasury = await Treasury.deploy();
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log("Treasury:", treasuryAddress);

  const treasuryContract = treasury as Contract;
  const boardroomContract = boardroom as Contract;

  console.log("Initializing Treasury...");
  await (
    await treasuryContract.initialize(
      peg,
      share,
      oracle,
      boardroomAddress,
      startTime,
    )
  ).wait();

  console.log("Initializing Boardroom...");
  await (
    await boardroomContract.initialize(peg, share, treasuryAddress)
  ).wait();

  console.log("Initialization complete.");
  console.log("\nVerification commands:");
  console.log(`npx hardhat verify --network <network> ${boardroomAddress}`);
  console.log(`npx hardhat verify --network <network> ${treasuryAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

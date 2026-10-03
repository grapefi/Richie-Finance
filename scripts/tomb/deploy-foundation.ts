import {getAddress, isAddress} from "ethers";
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

  const startTime = requiredTimestamp("TOMB_START_TIME");
  const communityFund = requiredAddress("TOMB_COMMUNITY_FUND");
  const devFund = requiredAddress("TOMB_DEV_FUND");

  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock || startTime <= BigInt(latestBlock.timestamp)) {
    throw new Error("TOMB_START_TIME must be in the future");
  }

  console.log("Deployer:", deployer.address);
  console.log("Start time:", startTime.toString());

  const Peg = await ethers.getContractFactory("contracts/tomb/Peg.sol:Peg");
  const peg = await Peg.deploy();
  await peg.waitForDeployment();
  const pegAddress = await peg.getAddress();
  console.log("PEG:", pegAddress);

  const Share = await ethers.getContractFactory(
    "contracts/tomb/Share.sol:Share",
  );
  const share = await Share.deploy(startTime, communityFund, devFund);
  await share.waitForDeployment();
  const shareAddress = await share.getAddress();
  console.log("SHARE:", shareAddress);

  const Genesis = await ethers.getContractFactory(
    "contracts/tomb/GenesisRewardPool.sol:GenesisRewardPool",
  );
  const genesis = await Genesis.deploy(pegAddress, startTime);
  await genesis.waitForDeployment();
  const genesisAddress = await genesis.getAddress();
  console.log("GenesisRewardPool:", genesisAddress);

  console.log("\nVerification commands:");
  console.log(`npx hardhat verify --network <network> ${pegAddress}`);
  console.log(
    `npx hardhat verify --network <network> ${shareAddress} ${startTime} ${communityFund} ${devFund}`,
  );
  console.log(
    `npx hardhat verify --network <network> ${genesisAddress} ${pegAddress} ${startTime}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

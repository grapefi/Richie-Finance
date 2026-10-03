import {getAddress, isAddress} from "ethers";
import {network} from "hardhat";

function requiredAddress(name: string): string {
  const value = process.env[name];
  if (!value || !isAddress(value)) {
    throw new Error(`${name} must be a valid address`);
  }
  return getAddress(value);
}

function uintEnv(name: string, fallback?: bigint): bigint {
  const value = process.env[name];
  if (!value) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} is required`);
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer`);
  }
  return BigInt(value);
}

async function main() {
  const {ethers} = await network.connect();
  const [deployer] = await ethers.getSigners();

  const pair = requiredAddress("TOMB_PAIR_ADDRESS");
  const period = uintEnv("TOMB_ORACLE_PERIOD", 6n * 60n * 60n);
  const startTime = uintEnv("TOMB_ORACLE_START_TIME");

  if (period === 0n) throw new Error("TOMB_ORACLE_PERIOD must be positive");

  console.log("Deployer:", deployer.address);

  const Oracle = await ethers.getContractFactory(
    "contracts/tomb/Oracle.sol:Oracle",
  );
  const oracle = await Oracle.deploy(pair, period, startTime);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();

  console.log("Oracle:", oracleAddress);
  console.log("Pair:", pair);
  console.log("Period:", period.toString());
  console.log("Start time:", startTime.toString());
  console.log("\nVerification command:");
  console.log(
    `npx hardhat verify --network <network> ${oracleAddress} ${pair} ${period} ${startTime}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

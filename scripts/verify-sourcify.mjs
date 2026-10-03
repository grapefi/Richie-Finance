import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_URL = "https://sourcify.dev/server";
const DEFAULT_TIMEOUT_SECONDS = 120;

function usage() {
  console.log(`Verify a deployed contract with Sourcify.

Usage:
  npm run verify:sourcify -- --chain-id <chain-id> --address <contract-address> --contract <source-path:contract-name> [--creation-tx <transaction-hash>] [--build-info <path>] [--api-url <url>] [--timeout <seconds>]

Example:
  npm run verify:sourcify -- --chain-id 369 --address 0xECAA28d52FFAb55219e02048b7153CE119BF7e30 --contract contracts/tomb/Share.sol:Share --creation-tx 0x2026fe1ccce5ab65ac9703ca127fab0b214ab260396e9a310004d56122213581

The script uses the newest matching file in artifacts/build-info by default.
Pass --build-info when verifying an older deployment with several matching builds.`);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag === "--help" || flag === "-h") {
      args.help = true;
      continue;
    }

    if (!flag.startsWith("--")) {
      throw new Error(`Unexpected argument: ${flag}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }

    args[flag.slice(2)] = value;
    index += 1;
  }

  return args;
}

function requireArgument(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required argument --${name}`);
  }
  return value;
}

function validateHex(value, bytes, label) {
  const pattern = new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);
  if (!pattern.test(value)) {
    throw new Error(`${label} must be a ${bytes}-byte 0x-prefixed hex value`);
  }
}

function parseContractIdentifier(identifier) {
  const separator = identifier.lastIndexOf(":");
  if (separator <= 0 || separator === identifier.length - 1) {
    throw new Error(
      "--contract must use the format source/path/Contract.sol:ContractName",
    );
  }

  return {
    sourceName: identifier.slice(0, separator).replaceAll("\\", "/"),
    contractName: identifier.slice(separator + 1),
  };
}

async function loadBuildInfo(filePath) {
  const contents = await readFile(filePath, "utf8");
  const buildInfo = JSON.parse(contents);

  if (buildInfo.input?.sources === undefined) {
    throw new Error(`${filePath} does not contain Solidity standard JSON input`);
  }

  if (typeof buildInfo.solcLongVersion !== "string") {
    throw new Error(`${filePath} does not contain solcLongVersion`);
  }

  return buildInfo;
}

function resolveSourceName(buildInfo, requestedSourceName) {
  const sources = buildInfo.input.sources;
  if (Object.hasOwn(sources, requestedSourceName)) {
    return requestedSourceName;
  }

  const mappedSourceName = buildInfo.userSourceNameMap?.[requestedSourceName];
  if (mappedSourceName !== undefined && Object.hasOwn(sources, mappedSourceName)) {
    return mappedSourceName;
  }

  const suffix = `/${requestedSourceName}`;
  const matches = Object.keys(sources).filter((sourceName) =>
    sourceName.endsWith(suffix),
  );

  return matches.length === 1 ? matches[0] : undefined;
}

async function findBuildInfo(requestedPath, requestedSourceName) {
  if (requestedPath !== undefined) {
    const filePath = path.resolve(requestedPath);
    const buildInfo = await loadBuildInfo(filePath);
    const sourceName = resolveSourceName(buildInfo, requestedSourceName);
    if (sourceName === undefined) {
      throw new Error(`${requestedSourceName} was not found in ${filePath}`);
    }
    return { buildInfo, filePath, sourceName };
  }

  const buildInfoDirectory = path.resolve("artifacts", "build-info");
  const entries = await readdir(buildInfoDirectory, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      entry.name.endsWith(".output.json")
    ) {
      continue;
    }

    const filePath = path.join(buildInfoDirectory, entry.name);
    const buildInfo = await loadBuildInfo(filePath);
    const sourceName = resolveSourceName(buildInfo, requestedSourceName);
    if (sourceName !== undefined) {
      const fileStats = await stat(filePath);
      candidates.push({ buildInfo, filePath, sourceName, mtimeMs: fileStats.mtimeMs });
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      `No Hardhat build info contains ${requestedSourceName}. Run npx hardhat compile first.`,
    );
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (candidates.length > 1) {
    console.log(
      `Found ${candidates.length} matching builds; using the newest. Use --build-info to select another.`,
    );
  }

  return candidates[0];
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;

  try {
    body = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    body = { message: text };
  }

  return { response, body };
}

function printContractResult(contract) {
  console.log("\nSourcify verification complete:");
  console.log(`  Address:        ${contract.address}`);
  console.log(`  Chain ID:       ${contract.chainId}`);
  console.log(`  Match:          ${contract.match}`);
  console.log(`  Creation match: ${contract.creationMatch}`);
  console.log(`  Runtime match:  ${contract.runtimeMatch}`);
  console.log(
    `  Repository:     https://repo.sourcify.dev/${contract.chainId}/${contract.address}`,
  );
}

function printExternalVerificationWarnings(externalVerifications) {
  if (externalVerifications === undefined) return;

  for (const [provider, result] of Object.entries(externalVerifications)) {
    if (result?.error === undefined) continue;
    const firstLine = String(result.error).split(/\r?\n/, 1)[0];
    console.warn(`Warning: ${provider} relay failed: ${firstLine}`);
  }
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const chainId = requireArgument(args, "chain-id");
  const address = requireArgument(args, "address");
  const requestedContract = requireArgument(args, "contract");
  const creationTransactionHash = args["creation-tx"];
  const apiUrl = (args["api-url"] ?? DEFAULT_API_URL).replace(/\/$/, "");
  const timeoutSeconds = Number(args.timeout ?? DEFAULT_TIMEOUT_SECONDS);

  if (!/^\d+$/.test(chainId)) {
    throw new Error("--chain-id must be a positive integer");
  }
  validateHex(address, 20, "--address");
  if (creationTransactionHash !== undefined) {
    validateHex(creationTransactionHash, 32, "--creation-tx");
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("--timeout must be a positive number of seconds");
  }

  const { sourceName, contractName } = parseContractIdentifier(requestedContract);

  const lookupUrl = `${apiUrl}/v2/contract/${chainId}/${address}`;
  const existing = await requestJson(lookupUrl);
  if (existing.response.ok) {
    console.log("Contract is already verified on Sourcify.");
    printContractResult(existing.body);
    return;
  }
  if (existing.response.status !== 404) {
    throw new Error(
      `Sourcify lookup failed (${existing.response.status}): ${JSON.stringify(existing.body)}`,
    );
  }

  const selected = await findBuildInfo(args["build-info"], sourceName);
  const contractIdentifier = `${selected.sourceName}:${contractName}`;
  console.log(`Build info: ${selected.filePath}`);
  console.log(`Compiler:   ${selected.buildInfo.solcLongVersion}`);
  console.log(`Contract:   ${contractIdentifier}`);

  const submission = {
    stdJsonInput: selected.buildInfo.input,
    compilerVersion: selected.buildInfo.solcLongVersion,
    contractIdentifier,
  };
  if (creationTransactionHash !== undefined) {
    submission.creationTransactionHash = creationTransactionHash;
  }

  const submitUrl = `${apiUrl}/v2/verify/${chainId}/${address}`;
  const submitted = await requestJson(submitUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission),
  });

  if (!submitted.response.ok || typeof submitted.body.verificationId !== "string") {
    throw new Error(
      `Sourcify submission failed (${submitted.response.status}): ${JSON.stringify(submitted.body)}`,
    );
  }

  const verificationId = submitted.body.verificationId;
  console.log(`Verification ID: ${verificationId}`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const status = await requestJson(`${apiUrl}/v2/verify/${verificationId}`);
    if (!status.response.ok) {
      throw new Error(
        `Sourcify status request failed (${status.response.status}): ${JSON.stringify(status.body)}`,
      );
    }

    if (status.body.isJobCompleted === true) {
      printExternalVerificationWarnings(status.body.externalVerifications);
      if (status.body.contract === undefined) {
        throw new Error(`Verification failed: ${JSON.stringify(status.body)}`);
      }
      printContractResult(status.body.contract);
      return;
    }

    await sleep(2_000);
  }

  throw new Error(
    `Verification did not finish within ${timeoutSeconds} seconds. Check the job later: ${apiUrl}/v2/verify/${verificationId}`,
  );
}

main().catch((error) => {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

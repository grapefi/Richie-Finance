# Tomb deployment and configuration

All deployable contracts in `contracts/tomb` are covered. Interfaces are not deployed.
Scripts use the signer/network from Hardhat. They do not create liquidity pairs,
schedule oracle updates, or automatically save deployed addresses.

## Environment

Merge [the example](.env.example) into the repository's existing `.env`. Keep
your existing RPC/private-key settings; never overwrite or commit the real
`.env`. Replace `0x...` placeholders with actual addresses. Empty optional
entries can stay empty. PowerShell `$env:TOMB_...` values override the file.

Choose a future Unix start time that leaves enough time for deployment, liquidity,
configuration, funding, and oracle priming:

```powershell
$env:TOMB_START_TIME = [DateTimeOffset]::UtcNow.AddDays(7).ToUnixTimeSeconds().ToString()
```

Save each printed deployment address under its matching `TOMB_*_ADDRESS` entry.
Deployment scripts always deploy NEW contracts; configuration scripts can be
rerun against existing deployments without duplicating pools/reward distributions.

## Deployment order

Run these commands from the repository root. They select PulseChain mainnet.

1. Set `TOMB_START_TIME`, `TOMB_COMMUNITY_FUND`, and `TOMB_DEV_FUND`, then deploy
   PEG, SHARE, and GenesisRewardPool:

   ```powershell
   npm run tomb:deploy:foundation -- --network pulse
   ```

2. Create and seed the intended PEG pricing pair and a SHARE/WPLS pair on PulseX.
   Both need nonzero reserves. Set `TOMB_PAIR_ADDRESS` (PEG pricing pair) and
   `TOMB_SHARE_PAIR_ADDRESS`. Treasury treats the PEG oracle's quote token as
   the peg unit: use PEG/PDAI for a PDAI peg. The farm PSM requires SHARE/WPLS.

3. Set both oracle start timestamps to approximately the current Unix time,
   not the future farming start, so observations can be primed before launch.
   Each start must be at least its period, then run:

   ```powershell
   npm run tomb:deploy:oracle -- --network pulse
   npm run tomb:deploy:share-oracle -- --network pulse
   ```

   PEG uses `TOMB_ORACLE_PERIOD` (default 21,600 seconds) and
   `TOMB_ORACLE_START_TIME`. SHARE uses `TOMB_SHARE_ORACLE_PERIOD` (default
   3,600) and `TOMB_SHARE_ORACLE_START_TIME`, falling back to `TOMB_START_TIME`.
   Save the addresses separately. Keep SHARE's period no longer than
   `TOMB_PSM_MAX_ORACLE_AGE` (default 7,200 seconds).

4. Deploy and initialize Treasury/Boardroom, then deploy the farm:

   ```powershell
   npm run tomb:deploy:core -- --network pulse
   npm run tomb:deploy:farm -- --network pulse
   ```

   Core needs PEG, SHARE, PEG oracle addresses and `TOMB_START_TIME`.
   Farm needs SHARE and `TOMB_FARM_START_TIME` (defaults to `TOMB_START_TIME`).

5. Configure pools before funding or launch:

   ```powershell
   npm run tomb:add:pools -- --network pulse
   npm run tomb:configure:farm -- --network pulse
   ```

   Keep `TOMB_PSM_ENABLED=false` initially. Example environment JSON:

   ```dotenv
   TOMB_GENESIS_POOLS='[{"token":"0x...","allocPoint":"100","depositFeeBps":0},{"token":"0x...","allocPoint":"50","depositFeeBps":100}]'
   TOMB_FARM_POOLS='[{"token":"0x...","allocPoint":"100"}]'
   ```

   Genesis fees use basis points: 100 = 1%, maximum 1000 = 10%.
   `TOMB_GENESIS_FEE_RECIPIENT` optionally changes the fee destination.
   SHARE cannot be a farm stake token; PEG cannot be a Genesis stake token.
   Matching tokens are updated instead of added twice. Unlisted pools are
   NOT removed or set to zero. Allocation strings avoid precision loss.
   These scripts always checkpoint rewards when adding pools and require
   `lastRewardTime` omitted or zero, avoiding delayed-activation accounting.
   Multi-pool allocation updates use separate transactions, not an atomic switch.

6. Fund rewards and connect the core system:

   ```powershell
   npm run tomb:configure -- --network pulse
   ```

   Sends 2,400 PEG to Genesis and 41,000 SHARE to the farm once per token
   contract. There is no second PEG LP-reward destination. Transfers PEG/SHARE
   and Boardroom operational control to Treasury. Treasury/Genesis/farm
   administration stays with the signer. Run as deployer before final admin
   transfer. Optional Treasury/Boardroom settings are in `.env.example`;
   blank values preserve current settings. DAO/dev fund changes require all
   four related entries together.

7. Prime and maintain the oracles:

   ```powershell
   npm run tomb:update:oracles -- --network pulse
   ```

   Wait a full observation period after deployment/last update. The script
   skips observations not ready; it does not sleep or install a scheduler.
   Run regularly before SHARE becomes stale, and update PEG before Treasury
   allocations. Once SHARE has a fresh nonzero price, set
   `TOMB_PSM_ENABLED=true` and rerun farm configuration.
   PSM collects native PLS at harvest using SHARE/WPLS pricing. Fee defaults
   to 1,500 bps (15%), maximum 7,500. Thresholds use raw token units.

## Optional contracts

### PEG redemption

```powershell
npm run tomb:deploy:redeem -- --network pulse
npm run tomb:configure:redeem -- --network pulse
```

Needs PEG; PDAI defaults to PulseChain
`0x6B175474E89094C44Da98b954EedeAC495271d0F`.
Both tokens must have matching decimals because redemption is raw-unit 1:1.
`TOMB_REDEEM_PDAI_RESERVE_WEI` is the desired total reserve, not an amount to
add every run. The owner must hold sufficient PDAI. Configuration approves
and supplies only the shortfall; it does not withdraw an excess reserve.
Zero target means no funding.

### PEG/pDAI and SHARE/WPLS zaps

```powershell
npm run tomb:deploy:zap -- --network pulse
```

Needs PEG, SHARE, `TOMB_PEG_PDAI_PAIR_ADDRESS`, and `TOMB_SHARE_PAIR_ADDRESS`.
Both must be actual, funded pairs registered on the fixed PulseX V2 factory.
The script validates both before deploying and prints `TOMB_ZAP_ADDRESS`
and `TOMB_SHARE_ZAP_ADDRESS`. The constructors validate pair/router links.
This contract hardcodes PulseChain mainnet router/factory/WPLS/PDAI; it is
not a generic-network zap. There are no additional initialization/fee settings.
The final administration script handles both ownerships. Each zap accepts only
its two underlying ERC20 tokens; native PLS requires wrapping/swapping first.
The UI uses each pool's configured zap contract for atomic swap/add-liquidity.
PLS conversion/wrapping and optional Farm deposits remain separate transactions.
After redeployment, update the UI's matching zap address in `src/constants/contracts.ts`.

### Rebate treasury (optional; not part of the bondless core)

```powershell
npm run tomb:deploy:rebate-oracle -- --network pulse
npm run tomb:deploy:rebates -- --network pulse
npm run tomb:configure:rebates -- --network pulse
```

Accepts bridged **USD Coin from Ethereum** at
`0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07` (6 decimals), NOT the forked
Ethereum-address USDC copy. USDC is enabled automatically at deployment.
Prices are denominated in USDC, not a guarantee that bridged USDC always trades
at $1. Bridge/custody/depeg risks remain.

Create and seed a SHARE/bridged-USDC pair first. Set
`TOMB_REBATE_SHARE_PAIR_ADDRESS`, `TOMB_REBATE_ORACLE_PERIOD` (default 3,600
seconds), and `TOMB_REBATE_ORACLE_START_TIME` (current Unix time). Deploy the
rebate oracle and save its printed `TOMB_REBATE_SHARE_ORACLE_ADDRESS`.
This MUST be separate from the farm's SHARE/WPLS oracle. Update it with
`tomb:update:oracles` after a full observation period before accepting deposits.

Rebate deployment needs SHARE, Treasury, the rebate oracle, and the bridged
USDC contract already present on the target network. SHARE must have 18
decimals. Oracle prices must be nonzero and no older than
`TOMB_REBATE_MAX_ORACLE_AGE` (default 86,400 seconds). Keep the update period
no longer than that age and maintain regular updates. This remaining contract
still exposes bond/vesting features; core scripts do not deploy it automatically.
Existing deployments require a NEW RebateTreasury deployment; these contracts
are not upgradeable. Finish old vesting obligations before moving reserves.

Optional `TOMB_REBATE_ASSETS` example:

```dotenv
TOMB_REBATE_ASSETS='[{"token":"0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07","multiplier":"1000000"}]'
```

Multiplier precision is 1e6. Discount defaults to 70,000 (7% with a 1e6
denominator), vesting to 259,200 seconds. `TOMB_REBATE_SHARE_RESERVE_WEI` is
a target reserve funded from the owner's existing SHARE, separate from farm
rewards. Direct USDC does not need an asset oracle: its value is measured in
USDC itself. Other non-LP assets require token/USDC price oracles.
Enabled LP assets remain rejected by the configuration script: LP reserve-based
pricing needs separate manipulation-risk review before enabling it. The contract
now uses USDC rather than Avalanche MIM for that legacy path. Configuration is
not an audit or approval of rebate economics.

At 2 USDC per SHARE, a 100 USDC deposit (`100000000` raw units) with default
7% bonus/multiplier 1 yields 53.5 SHARE, vested over three days.
The existing `bond(token, amount)` and `claimRewards()` interfaces are retained.
An owner can pause new USDC deposits with
`setAsset(USDC, false, 1000000, address(0), false, address(0))`; claims continue.

#### Optional native PLS rebates

PLS deposits use a **WPLS/bridged-USDC** TWAP oracle in addition to the existing
SHARE/USDC oracle. The farm's SHARE/WPLS oracle is not suitable for this quote.
Create/seed a WPLS/USDC pair and set:

```dotenv
TOMB_REBATE_PLS_PAIR_ADDRESS=0x...
TOMB_REBATE_PLS_ORACLE_PERIOD=3600
TOMB_REBATE_PLS_ORACLE_START_TIME=...
TOMB_REBATE_PLS_ENABLED=true
TOMB_REBATE_PLS_MULTIPLIER=1000000
```

Deploy its oracle, save the printed `TOMB_REBATE_PLS_ORACLE_ADDRESS`, and configure:

```powershell
npm run tomb:deploy:rebate-pls-oracle -- --network pulse
npm run tomb:configure:rebates -- --network pulse
# After a full observation period:
npm run tomb:update:oracles -- --network pulse
```

Both price observations must be fresh/nonzero before PLS bonding works.
`TOMB_REBATE_PLS_ENABLED=false` disables new native PLS and WPLS deposits;
leaving the setting empty preserves the current asset configuration. Configure
WPLS using these settings OR the asset JSON, not both. The multiplier uses 1e6
precision and affects both native PLS and ERC20 WPLS rebates.

From ethers, quote and deposit native PLS with a user-chosen minimum SHARE return:

```typescript
const amount = ethers.parseEther("100");
const quote = await rebates.getShareReturn(await rebates.WPLS(), amount);
const minShareOut = quote * 99n / 100n; // example: tolerate at most 1% below quote
await (await rebates.bondPLS(minShareOut, { value: amount })).wait();
```

Do not send PLS directly to the contract: plain transfers revert instead of
silently taking funds without creating vesting. Native deposits stay as PLS;
no wrapping or swap occurs. ERC20 WPLS can also be approved and deposited through
`bond(WPLS, amount)`. The owner recovers native reserves with `withdrawPLS(amount)`;
ERC20 reserves still use their existing withdrawal/buyback functions.

PLS and USDC deposits share the same per-user vesting schedule. A new deposit
first claims available rewards, then restarts vesting for the remaining balance
plus the new reward (the existing top-up behavior). At 0.0001 USDC per PLS and
2 USDC per SHARE, 100 PLS yields 0.00535 SHARE with the default 7% bonus.
PLS is disabled by default until its WPLS asset/oracle is configured. Redeploy
RebateTreasury if you already deployed a version without `bondPLS`.

## Final administration transfer

After configuration/funding, set `TOMB_ADMIN_ADDRESS` to the intended admin
or multisig and run explicitly:

```powershell
npm run tomb:transfer:admin -- --network pulse
```

Only contracts with nonempty address entries are processed. Transfers token
ownership; Treasury/Genesis/farm operators; oracle ownership/operators; and
optional redemption/rebate/zap ownership. PEG/SHARE/Boardroom operational
permissions stay with Treasury. Further configuration requires the new
authorized account, not the original deployer.

Configuration is multi-transaction: later failures do not roll back earlier
transactions. Review settings, addresses, pool JSON, balances and output before
mainnet use. Scripts do not fix existing contract accounting risks.

## Local checks

```powershell
npm run tomb:check:scripts
npx hardhat test test/Rebates.test.ts test/TombDeployment.test.ts test/Peg.test.ts
```

Integration tests use mock tokens/pairs/router and exercise all new deployments,
rerun-safe funding/pool setup, oracle priming, PSM enablement, and administration
transfer. They do not send mainnet transactions or validate live liquidity,
pricing quality, or zap swaps.

# Risks and security

Richie is an experimental DeFi protocol. Providing liquidity, farming, staking, or buying a treasury rebate can result in a partial or total loss. The exposures below are part of how the intended system works.

## Peg and reference-asset risk

CASH may trade below one PDAI for periods. PDAI is the reference asset. A stable CASH/PDAI ratio does not protect either token's value in dollars. 

## Liquidity and position risk

A CASH/PDAI pool can lose value and shift toward the weaker asset. Impermanent loss, price impact, concentrated-position behavior, and low liquidity can affect results.

RICH has no peg. Its price may fall or rise sharply based on market demand.

## Treasury risk

Investments can lose principal or stop paying income. PLS and other treasury assets may fall relative to PDAI. 

## Reward and fee risk

Emissions can dilute token holders and create selling pressure. CASH expansion rewards are intended to pause during contraction. Net participation returns depend on token prices, PSM fees, gas, other applicable fees, and the underlying liquidity position.

## Treasury rebates and lock risk

Treasury rebates expose buyers to RICH market prices. A discount at purchase can disappear before fully vesting.

Staking and farm locks can prevent immediate exits. Read the final timers and reset conditions before depositing or claiming.

## Contract and infrastructure risk

Solidity contracts and DeFi are inherently experimental in nature. All protocols pose a potential code risk. 

Richie Finance mitigates contract risk significantly by using only tried and true battle tested contracts that have safely held billions of dollars in TVL over years without exploit through many Tomb forks including the revised Tomb Finance deployed on Fantom network in 2021. 

## Administrator risk

Controllers have limited protocol powers however they do have ability to change fees, reward rules and asset allocations. Any admin changes will be notified ahead of time.

See [governance and permissions](governance-and-permissions.md), [parameters and fees](parameters-and-fees.md), and [disclaimer](disclaimer.md).

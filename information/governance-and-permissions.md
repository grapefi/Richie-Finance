# Governance and permissions

Richie Finance is an autonomous protocol designed to manage a decentralized PDAI pegged coin.

A set of contracts do this based on code values, the admins have limited ability to impact the core feature set of the protocol. These admin controls are limited to changing incentive rates and adding new pools for rewards. Admins cannot mint tokens or control peg values.

| Area | Relevant powers |
| --- | --- |
| CASH Minting | Only the treasury contract can mint new CASH based on the last epoch's TWAP value, it does this each epoch via a public available call. The admin can set the expansion percentage to control inflation or incentivize staking however they cannot mint CASH tokens themselves. |
| RICH Minting | After launch RICH tokens are fully minted and sent to The Marina staking pool, there is no mint function on the RICH token. No more can ever be minted. These tokens stream to stakers in The Marina contract linearly over 1 year. |
| The Marina & Genesis Pools | Admins can add new pools and change reward weightings of existing pools, this will be communicated on official socials. Admins cannot remove rewards you have already earned and cannot remove CASH or RICH tokens from these pools. |
| RICH Staking | Admins can change the reward lockups up to a hardcoded maximum of 56 epochs |
| Oracle | Admins have no control over TWAP values determined by the oracle contract |
| PSM | Admins can change the PSM fee rate up to a maximum of 50% of reward value |
| Treasury Rebates | Admins can add/remove tokens from current available Treasury rebates |
| Contracts | Contracts deployed are not upgradable, they are verified on Sourcify |

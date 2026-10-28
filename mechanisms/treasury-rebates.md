# Treasury Rebates

Richie will implement **OHM-style treasury rebates** as an additional tool for acquiring assets and liquidity.

The purpose is to help build productive protocol capital through an asset-for-token exchange. It is separate from traditional Tomb-style contraction debt bonds which are not implemented in the Richie Finance protocol.

## The rebate model
![Treasury rebates](../media/81d801e2-42a3-4477-b347-02ff7ba75f5d.jpg)
A user would 'purchase' RICH tokens through the rebate contract at a discount to the current market rate using any of the available whitelisted Pulsechain assets. These RICH tokens then vest over a 3 day period linearly to the user.

The treasury gains control of the deposited Pulsechain asset and puts it to work in the protocol treasury. 

## How this differs from tomb style contraction bonds

| | OHM-style treasury rebates | Traditional Tomb-style contraction bonds |
| --- | --- | --- |
| Main purpose | Acquire approved treasury assets or liquidity | Remove the peg token from circulation during contraction |
| Typical input | An approved asset or LP position | The protocol's peg token |
| Participant receives | A discounted token payout of RICH tokens | A debt claim whose redemption typically depends on recovery conditions |
| Key uncertainty | RICH price at full payout and vesting time | Whether and when redemption conditions return |
| Status | Will launch shortly after genesis  | Not implemented in our protocol |

## A discount is not guaranteed profit

A rebate offers RICH tokens at a discount to the current market price. The RICH token however can fall or rise in price before it is fully vested to the user. As such a discount at purchase does not lock in a guaranteed return.

From the protocol's perspective, acquiring assets also commits it to token payouts. As a result there will only ever be a limited amount of RICH tokens that will be available for discounted rebate purchases and this will depend on market and protocol conditions.

For background on the design inspiration, Olympus describes asset-acquisition and liquidity rebates in its [bond documentation](https://docs.olympusdao.finance/main/legacy/bonding). 

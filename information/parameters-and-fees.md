# Protocol parameters

| Item | Protocol design |
| --- | --- |
| Peg token | CASH |
| Share token | RICH |
| CASH target | 1 PDAI per CASH |
| CASH Supply | Algorithmic based on peg value, 1 token minted on deployment to create LP |
| RICH Supply| 50,001 tokens max supply, supply minted at launch to fund LP reward pool |
| RICH Emission Schedule | 40,000 tokens streamed to Marina stakers over 1 year, 10,000 held by the Treasury to use for rebates, 1 share minted on deployment to create LP |
| PSM payment asset | PLS |
| PSM fee | 30% of the value of earned RICH rewards paid in PLS on claiming |
| Genesis pools fee | 1% on deposits |
| Genesis emissions | 50m CASH emitted linearly over the 3 day genesis |
| Genesis pools | PDAI, PLS, PLSX, HEX, PUSDC, EDAI, ATROPA, ICHIDAI |
| Treasury role | Reserves, revenue generation, liquidity, and peg defense |
| Treasury rebates | Provide discounted RICH shares in return for treasury asset accumulation |
| Epochs | Each epoch lasts 6 hours |
| Oracle | Protocol deployed TWAP oracle using a 6 hour manipulation resistant window |
| RICH Staking Locks | 4 epoch withdrawal lock, 2 epoch reward claims lock |
| Security | Tried and true contracts used that have held billions of dollars in TVL on EVM chains without exploits for years |

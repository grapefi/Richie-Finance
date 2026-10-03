// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Review-only fixtures. They are not production contracts or real market liquidity.
contract TombReviewToken is ERC20 {
    uint8 private immutable units;
    uint256 public senderFeeBps;
    constructor(uint8 d) ERC20("Review token", "REVIEW") { units = d; }
    function decimals() public view override returns (uint8) { return units; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setSenderFee(uint256 bps) external { senderFeeBps = bps; }
    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (from != address(0) && to != address(0) && senderFeeBps > 0) {
            super._update(from, address(0), amount * senderFeeBps / 10000);
        }
    }
}

contract TombReviewPair is ERC20 {
    address public token0;
    address public token1;
    uint112 public reserve0;
    uint112 public reserve1;
    uint32 public timestamp;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    constructor(address a, address b, uint112 r0, uint112 r1) ERC20("Review LP", "LP") {
        token0 = a; token1 = b; reserve0 = r0; reserve1 = r1;
        timestamp = uint32(block.timestamp);
    }
    function mintLP(address to, uint256 amount) external { _mint(to, amount); }
    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, timestamp);
    }
    function changeReserves(uint112 a, uint112 b) external {
        // Reproduce V2's deliberate timestamp/cumulative wrapping, not checked arithmetic.
        unchecked {
            uint32 elapsed = uint32(block.timestamp) - timestamp;
            if (reserve0 != 0 && reserve1 != 0) {
                price0CumulativeLast += ((uint256(reserve1) << 112) / reserve0) * elapsed;
                price1CumulativeLast += ((uint256(reserve0) << 112) / reserve1) * elapsed;
            }
        }
        reserve0 = a; reserve1 = b; timestamp = uint32(block.timestamp);
    }
}

contract TombReviewPriceOracle {
    address public token0;
    address public token1;
    uint256 public price;
    uint32 public blockTimestampLast;
    bool public failing;
    constructor(address a, address b, uint256 p) {
        token0 = a; token1 = b; price = p; blockTimestampLast = uint32(block.timestamp);
    }
    function failUpdates() external { failing = true; }
    function update() external { require(!failing, "update failed"); blockTimestampLast = uint32(block.timestamp); }
    function consult(address token, uint256 amount) external view returns (uint144) {
        require(token == token0); return uint144(amount * price / 1e18);
    }
    function twap(address token, uint256 amount) external view returns (uint144) {
        require(token == token0); return uint144(amount * price / 1e18);
    }
}

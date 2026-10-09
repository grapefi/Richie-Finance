// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract RebateSourceMock {
    address public token0;
    address public token1;
    uint32 public blockTimestampLast;
    uint256 public getPeriod = 3600;
    uint256 public nextEpochPoint;
    uint256 public numerator;
    uint256 public denominator;
    bool public failUpdate;
    constructor(address a, address b, uint256 n, uint256 d) {
        token0 = a; token1 = b; numerator = n; denominator = d;
        blockTimestampLast = uint32(block.timestamp);
        nextEpochPoint = block.timestamp + 3600;
    }
    function setTimestamp(uint32 t) external { blockTimestampLast = t; }
    function setPeriod(uint256 p) external { getPeriod = p; }
    function setNext(uint256 t) external { nextEpochPoint = t; }
    function setRate(uint256 n, uint256 d) external { numerator = n; denominator = d; }
    function setFailUpdate(bool fail) external { failUpdate = fail; }
    function update() external {
        require(!failUpdate, "Mock: failed update");
        blockTimestampLast = uint32(block.timestamp);
        nextEpochPoint = block.timestamp + getPeriod;
    }
    function consult(address token, uint256 amount) external view returns (uint144) {
        require(token == token0 || token == token1, "Mock: invalid token");
        if (numerator == 0) return 0;
        uint256 value = token == token0 ? Math.mulDiv(amount, numerator, denominator) : Math.mulDiv(amount, denominator, numerator);
        require(value <= type(uint144).max, "Mock: overflow");
        return uint144(value);
    }
}

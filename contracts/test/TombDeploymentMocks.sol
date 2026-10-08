// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TombScriptToken is ERC20 {
    constructor() ERC20("Test token", "TEST") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract TombScriptUSDC is TombScriptToken {
    function decimals() public pure override returns (uint8) { return 6; }
}

contract TombScriptRebateOracle {
    address public token0;
    address public token1;
    uint32 public blockTimestampLast;
    uint256 public price = 2e6;
    constructor(address share, address quote) {
        token0 = share; token1 = quote; blockTimestampLast = uint32(block.timestamp);
    }
    function setPrice(uint256 value) external { price = value; }
    function update() external { blockTimestampLast = uint32(block.timestamp); }
    function consult(address token, uint256 amount) external view returns (uint144) {
        require(token == token0);
        return uint144(amount * price / 1e18);
    }
}

contract TombScriptPair {
    function factory() external pure returns (address) { return 0x29eA7545DEf87022BAdc76323F373EA1e707C523; }
    address public token0;
    address public token1;
    uint32 private timestamp;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    uint112 private reserve0 = 1e18;
    uint112 private reserve1 = 1e18;
    constructor(address a, address b) { token0 = a; token1 = b; timestamp = uint32(block.timestamp); }
    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, timestamp);
    }
    function setReserves(uint112 a, uint112 b) external { reserve0 = a; reserve1 = b; timestamp = uint32(block.timestamp); }
}

contract TombScriptRouter {
    function factory() external pure returns (address) { return 0x29eA7545DEf87022BAdc76323F373EA1e707C523; }
    function WPLS() external pure returns (address) { return 0xA1077a294dDE1B09bB078844df40758a5D0f9a27; }
}

contract TombScriptFactory {
    mapping(bytes32 => address) private pairs;
    function setPair(address a, address b, address pair) external {
        pairs[keccak256(abi.encode(a, b))] = pair;
        pairs[keccak256(abi.encode(b, a))] = pair;
    }
    function getPair(address a, address b) external view returns (address) { return pairs[keccak256(abi.encode(a, b))]; }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IRebateSourceOracle {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function blockTimestampLast() external view returns (uint32);
    function getPeriod() external view returns (uint256);
    function nextEpochPoint() external view returns (uint256);
    function consult(address token, uint256 amount) external view returns (uint144);
    function update() external;
}

/// @notice Stored cross-TWAP quote RICH -> WPLS -> bridged USDC, not a direct-pair TWAP.
/// @dev Immutable wiring: deploy a new adapter to change sources or its age limit.
contract RebateCompositeOracle {
    address public constant WPLS = 0xA1077a294dDE1B09bB078844df40758a5D0f9a27;
    address public constant USDC = 0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07;
    address public immutable token0;
    address public constant token1 = USDC;
    IRebateSourceOracle public immutable sharePlsOracle;
    IRebateSourceOracle public immutable plsUsdcOracle;
    uint256 public immutable maxOracleAge;

    constructor(address share, address shareOracle, address plsOracle, uint256 age) {
        require(share != address(0) && share != WPLS && share != USDC, "Composite: invalid share");
        require(age >= 300 && age <= 7 days, "Composite: invalid age");
        _validatePair(shareOracle, share, WPLS);
        _validatePair(plsOracle, WPLS, USDC);
        token0 = share;
        sharePlsOracle = IRebateSourceOracle(shareOracle);
        plsUsdcOracle = IRebateSourceOracle(plsOracle);
        maxOracleAge = age;
        require(getPeriod() <= age, "Composite: period exceeds age");
    }

    function _validatePair(address oracle, address a, address b) private view {
        require(oracle.code.length > 0, "Composite: invalid oracle");
        address x = IRebateSourceOracle(oracle).token0();
        address y = IRebateSourceOracle(oracle).token1();
        require((x == a && y == b) || (x == b && y == a), "Composite: wrong pair");
    }

    /// @notice Oldest source timestamp; refreshing one leg cannot mask the other.
    function blockTimestampLast() external view returns (uint32) {
        uint32 a = sharePlsOracle.blockTimestampLast();
        uint32 b = plsUsdcOracle.blockTimestampLast();
        return a < b ? a : b;
    }

    function getPeriod() public view returns (uint256) {
        uint256 a = sharePlsOracle.getPeriod();
        uint256 b = plsUsdcOracle.getPeriod();
        return a > b ? a : b;
    }

    function nextEpochPoint() external view returns (uint256) {
        uint256 a = sharePlsOracle.nextEpochPoint();
        uint256 b = plsUsdcOracle.nextEpochPoint();
        return a > b ? a : b;
    }

    function _fresh(IRebateSourceOracle oracle) private view {
        uint256 timestamp = oracle.blockTimestampLast();
        require(timestamp > 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= maxOracleAge,
            "Composite: stale source");
        require(oracle.getPeriod() <= maxOracleAge, "Composite: period exceeds age");
    }

    /// @notice Raw token input/output units. 1e18 RICH returns 6-decimal USDC units.
    function consult(address token, uint256 amount) public view returns (uint144) {
        require(token == token0 || token == USDC, "Composite: invalid token");
        _fresh(sharePlsOracle);
        _fresh(plsUsdcOracle);
        if (amount == 0) return 0;
        uint144 intermediate;
        uint144 result;
        if (token == token0) {
            intermediate = sharePlsOracle.consult(token0, amount);
            result = plsUsdcOracle.consult(WPLS, intermediate);
        } else {
            intermediate = plsUsdcOracle.consult(USDC, amount);
            result = sharePlsOracle.consult(WPLS, intermediate);
        }
        require(intermediate > 0 && result > 0, "Composite: zero quote");
        return result;
    }

    /// @dev Compatibility alias: deliberately uses stored consult averages, not live twap().
    function twap(address token, uint256 amount) external view returns (uint144) {
        return consult(token, amount);
    }

    /// @notice Permissionless; only updates due sources after a full observation window.
    /// Source errors propagate rather than silently retaining an unsuccessful update.
    function update() external {
        _update(sharePlsOracle);
        _update(plsUsdcOracle);
    }

    function _update(IRebateSourceOracle oracle) private {
        if (block.timestamp >= oracle.nextEpochPoint() &&
            block.timestamp >= uint256(oracle.blockTimestampLast()) + oracle.getPeriod()) {
            oracle.update();
        }
    }
}

// SPDX-License-Identifier: MIT

pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IOracle {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function blockTimestampLast() external view returns (uint32);
    function update() external;
    function consult(address _token, uint256 _amountIn) external view returns (uint144 amountOut);
    function twap(address _token, uint256 _amountIn) external view returns (uint144 _amountOut);
}

interface ITreasury {
    function epoch() external view returns (uint256);
}

contract RebateTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Asset {
        bool isAdded;
        uint256 multiplier;
        address oracle;
    }

    struct VestingSchedule {
        uint256 amount;
        uint256 period;
        uint256 end;
        uint256 claimed;
        uint256 lastClaimed;
    }

    IERC20 public Share;
    IOracle public ShareOracle;
    ITreasury public Treasury;

    mapping (address => Asset) public assets;
    mapping (address => VestingSchedule) public vesting;

    uint256 public discount = 70000;

    uint256 public bondVesting = 3 days;
    uint256 public totalVested = 0;

    uint256 public lastBuyback;
    uint256 public buybackAmount = 100 * 1e4;

    // Official PulseChain DAI; all rebate prices are quoted in 18-decimal DAI units.
    address public constant DAI = 0xefD766cCb38EaF1dfd701853BFCe31359239F305;
    address public constant WPLS = 0xA1077a294dDE1B09bB078844df40758a5D0f9a27;
    uint256 public maxOracleAge = 1 days;
    uint256 public constant DENOMINATOR = 1e6;
    uint256 public constant MAX_DISCOUNT = 500000; // 50% with 1e6 precision
    event Bonded(address indexed account, address indexed token, uint256 amount, uint256 shares);
    event PLSWithdrawn(address indexed recipient, uint256 amount);

    /*
     * ---------
     * MODIFIERS
     * ---------
     */
    
    // Only allow a function to be called with a bondable asset

    modifier onlyAsset(address token) {
        require(assets[token].isAdded, "RebateTreasury: token is not a bondable asset");
        _;
    }

    /*
     * ------------------
     * EXTERNAL FUNCTIONS
     * ------------------
     */

    // Initialize parameters

    constructor(
        address share,
        address shareOracle,
        address treasury
    ) Ownable(msg.sender) {
        require(share != address(0), "RebateTreasury: zero share");
        require(shareOracle != address(0), "RebateTreasury: zero oracle");
        require(treasury != address(0), "RebateTreasury: zero treasury");
        Share = IERC20(share);
        ShareOracle = IOracle(shareOracle);
        Treasury = ITreasury(treasury);
        require(IERC20Metadata(DAI).decimals() == 18, "RebateTreasury: DAI decimals");
        require(IERC20Metadata(share).decimals() == 18, "RebateTreasury: share decimals");
        _validateShareOracle(shareOracle, share);
        assets[DAI] = Asset(true, DENOMINATOR, address(0));
    }
    
    // Bond asset for discounted Share at bond rate

    function bond(
        address token,
        uint256 amount
    ) external onlyAsset(token) nonReentrant {
        require(amount > 0, "RebateTreasury: invalid bond amount");
        uint256 shareAmount = getShareReturn(token, amount);
        require(shareAmount > 0, "RebateTreasury: zero share return");
        _checkShareReserve(shareAmount);
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        require(IERC20(token).balanceOf(address(this)) - balanceBefore == amount,
            "RebateTreasury: unsupported transfer fee");
        _vest(msg.sender, shareAmount);
        emit Bonded(msg.sender, token, amount, shareAmount);
    }

    // Native PLS uses the WPLS asset configuration; deposits stay native, not wrapped.
    // No receive() handler: a plain transfer must not silently miss vesting accounting.
    function bondPLS(uint256 minShareOut) external payable onlyAsset(WPLS) nonReentrant {
        require(msg.value > 0, "RebateTreasury: invalid bond amount");
        uint256 shareAmount = getShareReturn(WPLS, msg.value);
        require(shareAmount > 0, "RebateTreasury: zero share return");
        require(shareAmount >= minShareOut, "RebateTreasury: minimum share return");
        _checkShareReserve(shareAmount);
        _vest(msg.sender, shareAmount);
        emit Bonded(msg.sender, address(0), msg.value, shareAmount);
    }

    function _checkShareReserve(uint256 shareAmount) internal view {
        uint256 shareBalance = Share.balanceOf(address(this));
        require(shareBalance >= totalVested && shareAmount <= shareBalance - totalVested,
            "RebateTreasury: insufficient share balance");
    }

    function _vest(address account, uint256 shareAmount) internal {
        _claimVested(account);

        VestingSchedule storage schedule = vesting[account];
        schedule.amount = schedule.amount - schedule.claimed + shareAmount;
        schedule.period = bondVesting;
        schedule.end = block.timestamp + bondVesting;
        schedule.claimed = 0;
        schedule.lastClaimed = block.timestamp;
        totalVested += shareAmount;
    }

    // Claim available Share rewards from bonding

    function claimRewards() external nonReentrant {
        _claimVested(msg.sender);
    }

    /*
     * --------------------
     * RESTRICTED FUNCTIONS
     * --------------------
     */
    
    // Set Share token

    function setShare(address share) external onlyOwner {
        require(share != address(0), "RebateTreasury: zero share");
        require(totalVested == 0, "RebateTreasury: outstanding vesting");
        require(IERC20Metadata(share).decimals() == 18, "RebateTreasury: share decimals");
        _validateShareOracle(address(ShareOracle), share);
        Share = IERC20(share);
    }

    // Set Share oracle

    function setShareOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "RebateTreasury: zero oracle");
        _validateShareOracle(oracle, address(Share));
        ShareOracle = IOracle(oracle);
    }

    function _validateShareOracle(address oracle, address share) internal view {
        address a = IOracle(oracle).token0();
        address b = IOracle(oracle).token1();
        require((a == share && b == DAI) || (b == share && a == DAI),
            "RebateTreasury: oracle must be SHARE/DAI");
    }

    function setMaxOracleAge(uint256 age) external onlyOwner {
        require(age >= 300 && age <= 7 days, "RebateTreasury: oracle age out of range");
        maxOracleAge = age;
    }

    // Set Share treasury

    function setTreasury(address treasury) external onlyOwner {
        require(treasury != address(0), "RebateTreasury: zero treasury");
        Treasury = ITreasury(treasury);
    }
    
    // Set bonding parameters of token
    
    function setAsset(
        address token,
        bool isAdded,
        uint256 multiplier,
        address oracle
    ) external onlyOwner {
        require(token != address(0), "RebateTreasury: zero token");
        require(token != address(Share), "RebateTreasury: SHARE cannot be an asset");
        if (isAdded) {
            require(!_isV2Pair(token), "RebateTreasury: LP assets are not supported");
            require(multiplier > 0, "RebateTreasury: zero multiplier");
            _tokenUnit(token);
            if (token == DAI) {
                require(oracle == address(0), "RebateTreasury: direct DAI only");
            } else {
                require(oracle != address(0), "RebateTreasury: zero oracle");
                address a = IOracle(oracle).token0();
                address b = IOracle(oracle).token1();
                require((a == token && b == DAI) || (b == token && a == DAI),
                    "RebateTreasury: asset oracle must quote DAI");
            }
        }
        assets[token].isAdded = isAdded;
        assets[token].multiplier = multiplier;
        assets[token].oracle = oracle;
    }

    // Set bond pricing parameters

    function setBondParameters(
        uint256 _discount,
        uint256 _vestingPeriod
    ) external onlyOwner {
        require(_discount <= MAX_DISCOUNT, "RebateTreasury: discount too high");
        require(_vestingPeriod > 0, "RebateTreasury: zero vesting period");
        discount = _discount;
        bondVesting = _vestingPeriod;
    }

    // Redeem assets for buyback

    function redeemAssetsForBuyback(address[] calldata tokens) external onlyOwner {

        uint256 epoch = Treasury.epoch();
        require(lastBuyback != epoch, "RebateTreasury: already bought back");
        lastBuyback = epoch;

        for (uint256 t = 0; t < tokens.length; t ++) {
            require(assets[tokens[t]].isAdded, "RebateTreasury: invalid token");
            IERC20 Token = IERC20(tokens[t]);
            Token.safeTransfer(
                owner(),
                (Token.balanceOf(address(this)) * buybackAmount) / DENOMINATOR
            );
        }
    }

    /*
     * ------------------
     * INTERNAL FUNCTIONS
     * ------------------
     */

    function _claimVested(address account) internal {
        VestingSchedule storage schedule = vesting[account];
        if (schedule.amount == 0 || schedule.amount == schedule.claimed) return;
        if (block.timestamp <= schedule.lastClaimed || schedule.lastClaimed >= schedule.end) return;

        uint256 duration = (block.timestamp > schedule.end ? schedule.end : block.timestamp) - schedule.lastClaimed;
        uint256 claimable = block.timestamp >= schedule.end
            ? schedule.amount - schedule.claimed
            : Math.mulDiv(schedule.amount, duration, schedule.period);
        if (claimable == 0) return;

        schedule.claimed += claimable;
        schedule.lastClaimed = block.timestamp > schedule.end ? schedule.end : block.timestamp;
        totalVested -= claimable;
        Share.safeTransfer(account, claimable);
    }

    /*
     * --------------
     * VIEW FUNCTIONS
     * --------------
     */

    // Calculate Share return of bonding amount of token

    function getShareReturn(address token, uint256 amount) public view onlyAsset(token) returns (uint256) {
        uint256 sharePrice = getSharePrice();
        uint256 tokenPrice = getTokenPrice(token);
        require(sharePrice > 0, "RebateTreasury: zero share price");
        require(tokenPrice > 0, "RebateTreasury: zero token price");
        uint256 quoteValue = Math.mulDiv(amount, tokenPrice, _tokenUnit(token));
        uint256 shares = Math.mulDiv(quoteValue, 1e18, sharePrice);
        shares = Math.mulDiv(shares, discount + DENOMINATOR, DENOMINATOR);
        return Math.mulDiv(shares, assets[token].multiplier, DENOMINATOR);
    }


    // Get Share price from Oracle

    function getSharePrice() public view returns (uint256) {
        uint256 updated = ShareOracle.blockTimestampLast();
        require(updated <= block.timestamp && block.timestamp - updated <= maxOracleAge,
            "RebateTreasury: stale share oracle");
        return ShareOracle.consult(address(Share), 1e18);
    }

    // Get token price from Oracle

    function getTokenPrice(address token) public view onlyAsset(token) returns (uint256) {
        Asset memory asset = assets[token];
        // DAI quote units returned for exactly one whole input token.
        if (token == DAI) return 1e18;
        IOracle Oracle = IOracle(asset.oracle);
        uint256 updated = Oracle.blockTimestampLast();
        require(updated <= block.timestamp && block.timestamp - updated <= maxOracleAge,
            "RebateTreasury: stale asset oracle");
        return Oracle.consult(token, _tokenUnit(token));
    }

    function _tokenUnit(address token) internal view returns (uint256) {
        if (token == DAI || token == WPLS) return 1e18;
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        require(tokenDecimals <= 36, "RebateTreasury: unsupported token decimals");
        return 10 ** uint256(tokenDecimals);
    }

    // Get claimable vested Shares for account

    function claimableShares(address account) external view returns (uint256) {
        VestingSchedule memory schedule = vesting[account];
        if (block.timestamp <= schedule.lastClaimed || schedule.lastClaimed >= schedule.end) return 0;
        if (block.timestamp >= schedule.end) return schedule.amount - schedule.claimed;
        uint256 duration = (block.timestamp > schedule.end ? schedule.end : block.timestamp) - schedule.lastClaimed;
        return schedule.amount * duration / schedule.period;
    }

    function emergencyWithdraw(IERC20 token, uint256 amnt) external onlyOwner {
        if (address(token) == address(Share)) {
            uint256 shareBalance = Share.balanceOf(address(this));
            require(
                shareBalance >= totalVested && amnt <= shareBalance - totalVested,
                "RebateTreasury: Share reserved for vesting"
            );
        }
        token.safeTransfer(owner(), amnt);
    }

    // Reject standard Uniswap V2 / PulseX V2 pair tokens. LP reserve-based
    // pricing was intentionally removed because spot reserves are manipulable.
    function _isV2Pair(address token) internal view returns (bool) {
        (bool token0Ok, bytes memory token0Data) = token.staticcall(
            abi.encodeWithSignature("token0()")
        );
        (bool token1Ok, bytes memory token1Data) = token.staticcall(
            abi.encodeWithSignature("token1()")
        );
        (bool reservesOk, bytes memory reservesData) = token.staticcall(
            abi.encodeWithSignature("getReserves()")
        );
        return token0Ok && token0Data.length >= 32 &&
            token1Ok && token1Data.length >= 32 &&
            reservesOk && reservesData.length >= 96;
    }

    // Native reserves cannot be recovered with the ERC20 withdrawal function.
    function withdrawPLS(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= address(this).balance, "RebateTreasury: insufficient PLS balance");
        address recipient = owner();
        (bool success,) = payable(recipient).call{value: amount}("");
        require(success, "RebateTreasury: PLS transfer failed");
        emit PLSWithdrawn(recipient, amount);
    }

}

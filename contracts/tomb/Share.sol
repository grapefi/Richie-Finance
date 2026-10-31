// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Context.sol";

contract Operator is Context, Ownable {
    address private _operator;

    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);

    constructor() Ownable(msg.sender) {
        _operator = _msgSender();
        emit OperatorTransferred(address(0), _operator);
    }

    function operator() public view returns (address) {
        return _operator;
    }

    modifier onlyOperator() {
        require(_operator == _msgSender(), "operator: caller is not the operator");
        _;
    }

    function isOperator() public view returns (bool) {
        return _msgSender() == _operator;
    }

    function transferOperator(address newOperator_) public onlyOwner {
        _transferOperator(newOperator_);
    }

    function _transferOperator(address newOperator_) internal {
        require(newOperator_ != address(0), "operator: zero address given for new operator");
        emit OperatorTransferred(_operator, newOperator_);
        _operator = newOperator_;
    }
}


contract Share is ERC20Burnable, Operator {
    using SafeERC20 for IERC20;

    // TOTAL MAX SUPPLY = 50,001
    uint256 public constant FARMING_POOL_REWARD_ALLOCATION = 40000 ether;
    uint256 public constant COMMUNITY_FUND_POOL_ALLOCATION = 10000 ether;

    uint256 public constant VESTING_DURATION = 150 days;
    uint256 public startTime;
    uint256 public endTime;

    uint256 public communityFundRewardRate;
    uint256 public communityFundLastClaimed;
    address public communityFund;

    bool public rewardPoolDistributed = false;

    event TreasuryFundChanged(
        address indexed previousFund,
        address indexed newFund
    );

    constructor(uint256 _startTime, address _communityFund) ERC20("Rich Shares", "RICH") {
        _mint(msg.sender, 1 ether); // mint 1 Share for initial pools deployment

        startTime = _startTime;
        endTime = startTime + VESTING_DURATION;

        communityFundLastClaimed = startTime;

        communityFundRewardRate = COMMUNITY_FUND_POOL_ALLOCATION / VESTING_DURATION;

        require(_communityFund != address(0), "Address cannot be 0");
        communityFund = _communityFund;
    }

    function setTreasuryFund(address _communityFund) external {
        require(msg.sender == communityFund, "!dao");
        require(_communityFund != address(0), "zero fund");

        address previousFund = communityFund;
        communityFund = _communityFund;
        emit TreasuryFundChanged(previousFund, _communityFund);
    }

    function unclaimedTreasuryFund() public view returns (uint256 _pending) {
        uint256 _now = block.timestamp;
        if (_now > endTime) _now = endTime;
        if (communityFundLastClaimed >= _now) return 0;
        _pending = (_now - communityFundLastClaimed) * communityFundRewardRate;

        // Pay the per-second division remainder with the final vesting claim
        // so the community fund receives exactly 10,000 RICH in total.
        if (_now == endTime) {
            _pending +=
                COMMUNITY_FUND_POOL_ALLOCATION -
                communityFundRewardRate * VESTING_DURATION;
        }
    }

    /**
     * @dev Claim pending rewards to community fund
     */
    function claimRewards() external {
        uint256 _pending = unclaimedTreasuryFund();
        if (_pending > 0) {
            _mint(communityFund, _pending);
            communityFundLastClaimed = block.timestamp > endTime
                ? endTime
                : block.timestamp;
        }
    }

    /**
     * @notice distribute to reward pool (only once)
     */
    function distributeReward(address _farmingIncentiveFund) external onlyOperator {
        require(!rewardPoolDistributed, "only can distribute once");
        require(_farmingIncentiveFund != address(0), "!_farmingIncentiveFund");
        rewardPoolDistributed = true;
        _mint(_farmingIncentiveFund, FARMING_POOL_REWARD_ALLOCATION);
    }

    function burn(uint256 amount) public override {
        super.burn(amount);
    }

    function governanceRecoverUnsupported(
        IERC20 _token,
        uint256 _amount,
        address _to
    ) external onlyOperator {
        _token.safeTransfer(_to, _amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPulseXPair} from "./interfaces/IPulseXPair.sol";
import {IPulseXRouter02} from "./interfaces/IPulseXRouter02.sol";

interface IPulseXZapFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

abstract contract PulseXPairZap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct ZapInCache {
        IERC20 input;
        IERC20 other;
        address otherToken;
        uint256 inputBalanceBefore;
        uint256 otherBalanceBefore;
        uint256 sellAmount;
        uint256 otherAmount;
    }

    address public constant PULSEX_V2_ROUTER =
        0x165C3410fC91EF562C50559f7d2289fEbed552d9;
    address public constant PULSEX_V2_FACTORY =
        0x29eA7545DEf87022BAdc76323F373EA1e707C523;
    address public constant WPLS =
        0xA1077a294dDE1B09bB078844df40758a5D0f9a27;
    address public constant PDAI =
        0x6B175474E89094C44Da98b954EedeAC495271d0F;

    IERC20 public immutable TOKEN;
    IERC20 public immutable QUOTE;
    IERC20 public immutable LP;
    IPulseXRouter02 public immutable ROUTER;

    event ZappedIn(
        address indexed user,
        address indexed inputToken,
        uint256 inputAmount,
        uint256 liquidity
    );
    event ZappedOut(
        address indexed user,
        uint256 liquidity,
        uint256 pegAmount,
        uint256 pdaiAmount
    );

    constructor(address peg, address quote, address pegPdaiLp) Ownable(msg.sender) {
        require(peg != address(0), "PegPdaiZap: zero PEG");
        require(pegPdaiLp != address(0), "PegPdaiZap: zero LP");
        require(quote != address(0) && quote != peg, "Zap: invalid quote");

        IPulseXRouter02 router = IPulseXRouter02(PULSEX_V2_ROUTER);
        require(
            router.factory() == PULSEX_V2_FACTORY,
            "PegPdaiZap: wrong factory"
        );
        require(router.WPLS() == WPLS, "PegPdaiZap: wrong WPLS");
        require(
            IPulseXZapFactory(PULSEX_V2_FACTORY).getPair(peg, quote) == pegPdaiLp,
            "Zap: unregistered PulseX V2 pair"
        );

        address token0 = IPulseXPair(pegPdaiLp).token0();
        address token1 = IPulseXPair(pegPdaiLp).token1();
        require(
            (token0 == peg && token1 == quote) ||
                (token0 == quote && token1 == peg),
            "PegPdaiZap: wrong pair"
        );

        TOKEN = IERC20(peg);
        QUOTE = IERC20(quote);
        LP = IERC20(pegPdaiLp);
        ROUTER = router;
    }

    receive() external payable {}

    function zapInToken(
        address inputToken,
        uint256 amount,
        uint256 minSwapOut,
        uint256 minInputAdded,
        uint256 minOtherAdded,
        uint256 deadline
    ) external nonReentrant returns (uint256 liquidity) {
        require(
            inputToken == address(TOKEN) || inputToken == address(QUOTE),
            "PegPdaiZap: unsupported token"
        );
        require(amount > 1, "PegPdaiZap: amount too small");
        require(deadline >= block.timestamp, "PegPdaiZap: expired");

        ZapInCache memory cache;
        cache.input = IERC20(inputToken);
        cache.inputBalanceBefore = cache.input.balanceOf(address(this));
        cache.input.safeTransferFrom(msg.sender, address(this), amount);
        require(
            cache.input.balanceOf(address(this)) -
                cache.inputBalanceBefore ==
                amount,
            "PegPdaiZap: unsupported input token"
        );

        cache.otherToken = inputToken == address(TOKEN) ? address(QUOTE) : address(TOKEN);
        cache.other = IERC20(cache.otherToken);
        cache.otherBalanceBefore = cache.other.balanceOf(address(this));

        cache.sellAmount = amount / 2;
        cache.otherAmount = _swap(
            inputToken,
            cache.otherToken,
            cache.sellAmount,
            minSwapOut,
            deadline
        );

        cache.input.forceApprove(address(ROUTER), amount - cache.sellAmount);
        cache.other.forceApprove(address(ROUTER), cache.otherAmount);

        (, , liquidity) = ROUTER.addLiquidity(
            inputToken,
            cache.otherToken,
            amount - cache.sellAmount,
            cache.otherAmount,
            minInputAdded,
            minOtherAdded,
            msg.sender,
            deadline
        );

        cache.input.forceApprove(address(ROUTER), 0);
        cache.other.forceApprove(address(ROUTER), 0);

        _refundIncrease(cache.input, cache.inputBalanceBefore, msg.sender);
        _refundIncrease(cache.other, cache.otherBalanceBefore, msg.sender);

        emit ZappedIn(msg.sender, inputToken, amount, liquidity);
    }

    function zapOut(
        uint256 liquidity,
        uint256 minPegAmount,
        uint256 minPdaiAmount,
        uint256 deadline
    ) external nonReentrant returns (uint256 pegAmount, uint256 pdaiAmount) {
        require(liquidity > 0, "PegPdaiZap: zero liquidity");
        require(deadline >= block.timestamp, "PegPdaiZap: expired");

        LP.safeTransferFrom(msg.sender, address(this), liquidity);
        LP.forceApprove(address(ROUTER), liquidity);

        (pegAmount, pdaiAmount) = ROUTER.removeLiquidity(
            address(TOKEN),
            address(QUOTE),
            liquidity,
            minPegAmount,
            minPdaiAmount,
            msg.sender,
            deadline
        );

        LP.forceApprove(address(ROUTER), 0);
        emit ZappedOut(msg.sender, liquidity, pegAmount, pdaiAmount);
    }

    function _swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        IERC20(tokenIn).forceApprove(address(ROUTER), amountIn);
        uint256[] memory amounts = ROUTER.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            address(this),
            deadline
        );
        IERC20(tokenIn).forceApprove(address(ROUTER), 0);
        amountOut = amounts[amounts.length - 1];
    }

    function _refundIncrease(
        IERC20 token,
        uint256 balanceBefore,
        address recipient
    ) private {
        uint256 balanceAfter = token.balanceOf(address(this));
        if (balanceAfter > balanceBefore) {
            token.safeTransfer(recipient, balanceAfter - balanceBefore);
        }
    }

    function rescueToken(IERC20 token, uint256 amount) external onlyOwner {
        token.safeTransfer(owner(), amount);
    }

    function rescuePLS(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "PegPdaiZap: insufficient PLS");
        (bool success, ) = payable(owner()).call{value: amount}("");
        require(success, "PegPdaiZap: PLS transfer failed");
    }
}

contract PegPdaiZap is PulseXPairZap {
    constructor(address peg, address pair) PulseXPairZap(peg, PDAI, pair) {}
    // Preserve the existing PEG zap's public getters.
    function PEG() external view returns (IERC20) { return TOKEN; }
    function PEG_PDAI_LP() external view returns (IERC20) { return LP; }
}

contract ShareWplsZap is PulseXPairZap {
    constructor(address share, address pair) PulseXPairZap(share, WPLS, pair) {}
    function SHARE() external view returns (IERC20) { return TOKEN; }
    function SHARE_WPLS_LP() external view returns (IERC20) { return LP; }
}

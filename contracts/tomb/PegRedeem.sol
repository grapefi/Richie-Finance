// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract PegRedeem is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public PEG;
    IERC20 public PDAI;

    event Redeem(address indexed user, uint256 amount);
    event Supply(uint256 amount);
    event Retrieve(uint256 amount);

    constructor(IERC20 _PEG, IERC20 _PDAI) Ownable(msg.sender) {
        require(address(_PEG) != address(0), "PegRedeem: zero PEG");
        require(address(_PDAI) != address(0), "PegRedeem: zero PDAI");
        require(address(_PEG) != address(_PDAI), "PegRedeem: identical tokens");
        require(
            IERC20Metadata(address(_PEG)).decimals() == IERC20Metadata(address(_PDAI)).decimals(),
            "PegRedeem: decimals differ"
        );
        PEG = _PEG;
        PDAI = _PDAI;
    }

    function redeemPEG(uint256 amount) external nonReentrant {
        require(amount > 0, "PegRedeem: zero amount");
        require(
            PDAI.balanceOf(address(this)) >= amount,
            "PegRedeem: insufficient PDAI"
        );

        address recipient = owner();
        uint256 pegBalanceBefore = PEG.balanceOf(recipient);
        PEG.safeTransferFrom(msg.sender, recipient, amount);
        require(
            PEG.balanceOf(recipient) - pegBalanceBefore == amount,
            "PegRedeem: unsupported PEG token"
        );

        uint256 pdaiReserveBefore = PDAI.balanceOf(address(this));
        uint256 pdaiBalanceBefore = PDAI.balanceOf(msg.sender);
        PDAI.safeTransfer(msg.sender, amount);
        require(
            pdaiReserveBefore - PDAI.balanceOf(address(this)) == amount,
            "PegRedeem: unsupported PDAI sender tax"
        );
        require(
            PDAI.balanceOf(msg.sender) - pdaiBalanceBefore == amount,
            "PegRedeem: unsupported PDAI token"
        );

        emit Redeem(msg.sender, amount);
    }

    function supplyPDAI(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "PegRedeem: zero amount");
        uint256 balanceBefore = PDAI.balanceOf(address(this));
        PDAI.safeTransferFrom(msg.sender, address(this), amount);
        require(
            PDAI.balanceOf(address(this)) - balanceBefore == amount,
            "PegRedeem: unsupported PDAI token"
        );

        emit Supply(amount);
    }

    function retrievePDAI(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "PegRedeem: zero amount");
        require(
            PDAI.balanceOf(address(this)) >= amount,
            "PegRedeem: insufficient PDAI"
        );
        PDAI.safeTransfer(msg.sender, amount);

        emit Retrieve(amount);
    }
}

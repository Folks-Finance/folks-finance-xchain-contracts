// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@wormhole-solidity-sdk/interfaces/CCTPInterfaces/ITokenMessenger.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockCircleTokenMessenger is ITokenMessenger {
    event DepositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    );

    uint64 private _nonce;

    function setNonce(uint64 newNonce) external {
        _nonce = newNonce;
    }

    function depositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    ) external override returns (uint64 nonce) {
        SafeERC20.safeTransferFrom(IERC20(burnToken), msg.sender, address(this), amount);
        emit DepositForBurnWithCaller(amount, destinationDomain, mintRecipient, burnToken, destinationCaller);
        nonce = _nonce;
    }
}

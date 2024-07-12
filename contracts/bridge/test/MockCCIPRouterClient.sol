// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import { CCIPReceiver } from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import { IRouterClient } from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import { Client } from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../CCIPAdapter.sol";

contract MockCCIPRouterClient is IRouterClient {
    // TODO Client.EVM2AnyMessage- nested structs workaround https://github.com/NomicFoundation/hardhat/issues/4207
    event CCIPSend(
        uint64 destinationChainSelector,
        bytes receiver,
        bytes data,
        Client.EVMTokenAmount[] tokenAmounts,
        address feeToken,
        bytes extraArgs
    );

    bytes32 private _messageId;

    function setMessageId(bytes32 newMessageId) external {
        _messageId = newMessageId;
    }

    function isChainSupported(uint64) external pure override returns (bool supported) {
        supported = true;
    }

    function getSupportedTokens(uint64) external pure override returns (address[] memory tokens) {}

    function getFee(uint64, Client.EVM2AnyMessage calldata message) external pure override returns (uint256 fee) {
        fee = _fromBytes(message.extraArgs).gasLimit;
    }

    function ccipSend(
        uint64 destinationChainSelector,
        Client.EVM2AnyMessage calldata message
    ) external payable returns (bytes32) {
        if (message.tokenAmounts.length == 1) {
            Client.EVMTokenAmount memory tokenAmount = message.tokenAmounts[0];
            SafeERC20.safeTransferFrom(IERC20(tokenAmount.token), msg.sender, address(this), tokenAmount.amount);
        }

        emit CCIPSend(
            destinationChainSelector,
            message.receiver,
            message.data,
            message.tokenAmounts,
            message.feeToken,
            message.extraArgs
        );
        return _messageId;
    }

    function deliverToAdapter(CCIPAdapter adapter, Client.Any2EVMMessage calldata message) external {
        adapter.ccipReceive(message);
    }

    function _fromBytes(bytes calldata extraArgs) internal pure returns (Client.EVMExtraArgsV1 memory) {
        return abi.decode(extraArgs[4:], (Client.EVMExtraArgsV1));
    }
}

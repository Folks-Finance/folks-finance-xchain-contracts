// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../BridgeMessenger.sol";
import "../interfaces/IBridgeAdapter.sol";
import "../interfaces/IBridgeRouter.sol";
import "../libraries/Messages.sol";

contract MockBridgeRouter is IBridgeRouter {
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER");
    bytes32 public constant override MESSAGE_SENDER_ROLE = keccak256("MESSAGE_SENDER");

    // TODO Messages.MessageToSend - nested structs workaround https://github.com/NomicFoundation/hardhat/issues/4207
    event SendMessage(
        Messages.MessageParams params,
        bytes32 sender,
        uint16 destinationChainId,
        bytes32 handler,
        bytes payload,
        uint64 finalityLevel,
        bytes extraArgs
    );
    event MessageReceived(Messages.MessageReceived message);

    function getAdapter(uint16) external pure returns (IBridgeAdapter) {
        return IBridgeAdapter(address(0x6F92DaDBfF91f795d6215c5bdE955efE7a8CB912));
    }

    function getSendFee(Messages.MessageToSend memory message) external pure override returns (uint256) {
        return message.params.gasLimit;
    }

    function sendMessage(Messages.MessageToSend memory message) external payable {
        emit SendMessage(
            message.params,
            message.sender,
            message.destinationChainId,
            message.handler,
            message.payload,
            message.finalityLevel,
            message.extraArgs
        );
    }

    function receiveMessage(Messages.MessageReceived memory message) external payable {
        emit MessageReceived(message);
    }
}

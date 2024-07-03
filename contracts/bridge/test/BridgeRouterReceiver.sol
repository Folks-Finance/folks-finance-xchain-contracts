// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../BridgeMessenger.sol";
import "../interfaces/IBridgeAdapter.sol";
import "../interfaces/IBridgeRouter.sol";
import "../libraries/Messages.sol";

contract BridgeRouterReceiver is IBridgeRouter {
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
    event MessageReversed(Messages.MessageReceived message);
    event MessageFailed(bytes32 indexed messageId, bytes reason);
    event MessageSucceeded(bytes32 indexed messageId);

    function getAdapter(uint16) external pure returns (IBridgeAdapter) {
        return IBridgeAdapter(address(0));
    }

    function getSendFee(Messages.MessageToSend memory) external pure override returns (uint256) {
        return 0;
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
        // convert handler to address type (from lower 20 bytes)
        address handler = Messages.convertGenericAddressToEVMAddress(message.handler);

        // try to receive message
        try BridgeMessenger(handler).receiveMessage(message) {
            emit MessageSucceeded(message.messageId);
        } catch (bytes memory err) {
            emit MessageFailed(message.messageId, err);
            return;
        }

        emit MessageReceived(message);
    }

    function reverseMessage(Messages.MessageReceived memory message, bytes memory extraArgs) external payable {
        // convert handler to address type (from lower 20 bytes)
        address handler = Messages.convertGenericAddressToEVMAddress(message.handler);

        // try to receive message
        try BridgeMessenger(handler).reverseMessage(message, extraArgs) {
            emit MessageSucceeded(message.messageId);
        } catch (bytes memory err) {
            emit MessageFailed(message.messageId, err);
            return;
        }

        emit MessageReversed(message);
    }
}

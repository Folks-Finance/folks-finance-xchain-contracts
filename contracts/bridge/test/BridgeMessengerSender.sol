// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../BridgeMessenger.sol";
import "../libraries/Messages.sol";

contract BridgeMessengerSender is BridgeMessenger {
    event RecieveMessage(bytes32 messageId);

    constructor(IBridgeRouter bridgeRouter) BridgeMessenger(bridgeRouter) {}

    function sendMessage(Messages.MessageToSend memory message) external payable {
        _sendMessage(message, msg.value);
    }

    function _receiveMessage(Messages.MessageReceived memory message) internal pure override {
        revert CannotReceiveMessage(message.messageId);
    }

    function _reverseMessage(Messages.MessageReceived memory message, bytes memory) internal pure override {
        revert CannotReverseMessage(message.messageId);
    }
}

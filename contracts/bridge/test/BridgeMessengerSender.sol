// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../BridgeMessenger.sol";
import "../libraries/Messages.sol";

contract BridgeMessengerSender is BridgeMessenger {
    constructor(IBridgeRouter bridgeRouter) BridgeMessenger(bridgeRouter) {}

    function sendMessage(Messages.MessageToSend memory message) external payable {
        _sendMessage(message, msg.value);
    }

    function _receiveMessage(Messages.MessageReceived memory message) internal pure override {
        revert CannotReceiveMessage(message.messageId);
    }

    function _retryMessage(Messages.MessageReceived memory message, address, bytes memory) internal pure override {
        revert CannotRetryMessage(message.messageId);
    }

    function _reverseMessage(Messages.MessageReceived memory message, address, bytes memory) internal pure override {
        revert CannotReverseMessage(message.messageId);
    }
}

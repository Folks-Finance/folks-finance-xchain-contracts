// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../BridgeMessenger.sol";
import "../libraries/Messages.sol";

contract BridgeMessengerReceiver is BridgeMessenger {
    event ReceiveMessage(bytes32 messageId);
    event ReverseMessage(bytes32 messageId, bytes extraArgs);

    bool private shouldFail = false;

    constructor(IBridgeRouter bridgeRouter) BridgeMessenger(bridgeRouter) {}

    function setShouldFail(bool newShouldFail) external {
        shouldFail = newShouldFail;
    }

    function _receiveMessage(Messages.MessageReceived memory message) internal override {
        if (shouldFail) revert CannotReceiveMessage(message.messageId);
        emit ReceiveMessage(message.messageId);
    }

    function _reverseMessage(Messages.MessageReceived memory message, bytes memory extraArgs) internal override {
        if (shouldFail) revert CannotReverseMessage(message.messageId);
        emit ReverseMessage(message.messageId, extraArgs);
    }
}

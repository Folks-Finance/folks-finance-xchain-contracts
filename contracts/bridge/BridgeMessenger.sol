// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/IBridgeRouter.sol";
import "./libraries/Messages.sol";

abstract contract BridgeMessenger is ReentrancyGuard {
    error InvalidBridgeRouter(address router);
    error CannotReceiveMessage(bytes32 messageId);
    error CannotReverseMessage(bytes32 messageId);

    IBridgeRouter internal immutable bridgeRouter;

    modifier onlyRouter() {
        if (msg.sender != address(bridgeRouter)) revert InvalidBridgeRouter(msg.sender);
        _;
    }

    constructor(IBridgeRouter bridgeRouter_) {
        bridgeRouter = bridgeRouter_;
    }

    function receiveMessage(Messages.MessageReceived memory message) external virtual onlyRouter nonReentrant {
        _receiveMessage(message);
    }

    function reverseMessage(
        Messages.MessageReceived memory message,
        bytes memory extraArgs
    ) external virtual onlyRouter nonReentrant {
        _reverseMessage(message, extraArgs);
    }

    function getBridgeRouter() public view returns (address) {
        return address(bridgeRouter);
    }

    function _sendMessage(Messages.MessageToSend memory message, uint256 feeAmount) internal virtual {
        bridgeRouter.sendMessage{ value: feeAmount }(message);
    }

    function _receiveMessage(Messages.MessageReceived memory message) internal virtual;

    function _reverseMessage(Messages.MessageReceived memory message, bytes memory extraArgs) internal virtual;
}

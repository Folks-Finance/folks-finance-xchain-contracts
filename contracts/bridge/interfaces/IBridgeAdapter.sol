// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../libraries/Messages.sol";

interface IBridgeAdapter {
    event SendMessage(bytes32 operationId, Messages.MessageToSend message);
    event ReceiveMessage(bytes32 indexed messageId);

    error ChainAlreadyAdded(uint16 chainId);
    error ChainUnavailable(uint16 chainId);
    error InvalidBridgeRouter(address router);
    error InvalidMessageSender(bytes32 sourceAddress);
    error InvalidFinalityLevel(uint64 finalityLevel);
    error InvalidTokenAddress(bytes32 token);
    error InvalidReceivedAmount(uint256 expected, uint256 actual);
    error UnsupportedFinalityLevel(uint64 finalityLevel);
    error UnsupportedExtraArgs();
    error EmptyExtraArgs();

    function MANAGER_ROLE() external view returns (bytes32);

    function getSendFee(Messages.MessageToSend memory message) external view returns (uint256 fee);

    function sendMessage(Messages.MessageToSend memory message) external payable;

    /**
     * @notice Determine if chain is available to send messages to
     * @param chainId destination chain (as defined by Folks)
     * @return isAvailable whether is available
     */
    function isChainAvailable(uint16 chainId) external view returns (bool);
}

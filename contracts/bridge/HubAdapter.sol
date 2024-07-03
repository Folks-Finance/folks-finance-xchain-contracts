// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IBridgeAdapter.sol";
import "./interfaces/IBridgeRouter.sol";
import "./libraries/Messages.sol";

contract HubAdapter is IBridgeAdapter {
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER");
    bytes32 public constant PREFIX = "HUB_ADAPTER_V1";

    IBridgeRouter public immutable bridgeRouterSpoke;
    IBridgeRouter public immutable bridgeRouterHub;
    uint16 public immutable hubChainId;
    uint256 public sequence;

    modifier onlyBridgeRouter() {
        if (!(msg.sender == address(bridgeRouterSpoke) || msg.sender == address(bridgeRouterHub)))
            revert InvalidBridgeRouter(msg.sender);
        _;
    }

    /**
     * @notice Contructor
     * @param bridgeRouterSpoke_ The Bridge Router Spoke to route messages through
     * @param bridgeRouterHub_ The Bridge Router Hub to route messages through
     * @param hubChainId_ The hub chain id
     */
    constructor(IBridgeRouter bridgeRouterSpoke_, IBridgeRouter bridgeRouterHub_, uint16 hubChainId_) {
        bridgeRouterSpoke = bridgeRouterSpoke_;
        bridgeRouterHub = bridgeRouterHub_;
        hubChainId = hubChainId_;
        sequence = 0;
    }

    function getSendFee(Messages.MessageToSend memory message) external pure override returns (uint256 fee) {
        // no cross-chain communication
        fee = message.params.receiverValue;
    }

    function sendMessage(Messages.MessageToSend calldata message) external payable override onlyBridgeRouter {
        // check chain is available
        if (!isChainAvailable(message.destinationChainId)) revert ChainUnavailable(message.destinationChainId);

        // generate message id and increment so unique for next message
        bytes32 messageId = keccak256(abi.encodePacked(PREFIX, sequence));
        sequence += 1;

        // (if applicable) forward token
        Messages.ExtraArgsV1 memory extraArgs = Messages.bytesToExtraArgs(message.extraArgs);
        if (extraArgs.amount > 0)
            SafeERC20.safeTransfer(
                IERC20(Messages.convertGenericAddressToEVMAddress(extraArgs.token)),
                Messages.convertGenericAddressToEVMAddress(extraArgs.recipient),
                extraArgs.amount
            );

        // construct and forward message to opposing bridge router
        Messages.MessageReceived memory messageReceived = Messages.MessageReceived({
            messageId: messageId,
            sourceChainId: hubChainId,
            sourceAddress: message.sender,
            handler: message.handler,
            payload: message.payload,
            returnAdapterId: message.params.returnAdapterId,
            returnGasLimit: message.params.returnGasLimit
        });
        IBridgeRouter bridgeRouter = msg.sender == address(bridgeRouterSpoke) ? bridgeRouterHub : bridgeRouterSpoke;
        bridgeRouter.receiveMessage{ value: msg.value }(messageReceived);

        emit SendMessage(messageId, message);
        emit ReceiveMessage(messageReceived.messageId);
    }

    function isChainAvailable(uint16 chainId) public view override returns (bool) {
        return chainId == hubChainId;
    }
}

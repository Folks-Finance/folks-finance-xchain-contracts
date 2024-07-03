// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@wormhole-solidity-sdk/interfaces/IWormholeReceiver.sol";
import "@wormhole-solidity-sdk/interfaces/IWormholeRelayer.sol";

contract MockWormholeRelayer is IWormholeRelayer {
    event WormholeSendVaaKey(
        uint16 targetChain,
        address targetAddress,
        bytes payload,
        uint256 receiverValue,
        uint256 paymentForExtraReceiverValue,
        uint256 gasLimit,
        uint16 refundChain,
        address refundAddress,
        address deliveryProviderAddress,
        VaaKey[] vaaKeys,
        uint8 consistencyLevel
    );
    event WormholeSendMessageKey(
        uint16 targetChain,
        address targetAddress,
        bytes payload,
        uint256 receiverValue,
        uint256 paymentForExtraReceiverValue,
        uint256 gasLimit,
        uint16 refundChain,
        address refundAddress,
        address deliveryProviderAddress,
        MessageKey[] messageKeys,
        uint8 consistencyLevel
    );

    uint64 private _sequence;

    function setSequence(uint64 newSequence) external {
        _sequence = newSequence;
    }

    function getRegisteredWormholeRelayerContract(uint16) external pure override returns (bytes32) {}

    function deliveryAttempted(bytes32) external pure override returns (bool attempted) {}

    function deliverySuccessBlock(bytes32) external pure override returns (uint256 blockNumber) {}

    function deliveryFailureBlock(bytes32) external pure override returns (uint256 blockNumber) {}

    function deliver(bytes[] memory, bytes memory, address payable, bytes memory) external payable override {}

    function sendPayloadToEvm(
        uint16,
        address,
        bytes memory,
        uint256,
        uint256
    ) external payable override returns (uint64) {
        return 0;
    }

    function sendPayloadToEvm(
        uint16,
        address,
        bytes memory,
        uint256,
        uint256,
        uint16,
        address
    ) external payable override returns (uint64) {
        return 0;
    }

    function sendVaasToEvm(
        uint16,
        address,
        bytes memory,
        uint256,
        uint256,
        VaaKey[] memory
    ) external payable override returns (uint64 sequence) {}

    function sendVaasToEvm(
        uint16,
        address,
        bytes memory,
        uint256,
        uint256,
        VaaKey[] memory,
        uint16,
        address
    ) external payable override returns (uint64 sequence) {}

    function sendToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 paymentForExtraReceiverValue,
        uint256 gasLimit,
        uint16 refundChain,
        address refundAddress,
        address deliveryProviderAddress,
        VaaKey[] memory vaaKeys,
        uint8 consistencyLevel
    ) external payable override returns (uint64 sequence) {
        emit WormholeSendVaaKey(
            targetChain,
            targetAddress,
            payload,
            receiverValue,
            paymentForExtraReceiverValue,
            gasLimit,
            refundChain,
            refundAddress,
            deliveryProviderAddress,
            vaaKeys,
            consistencyLevel
        );
        return _sequence;
    }

    function sendToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256 receiverValue,
        uint256 paymentForExtraReceiverValue,
        uint256 gasLimit,
        uint16 refundChain,
        address refundAddress,
        address deliveryProviderAddress,
        MessageKey[] memory messageKeys,
        uint8 consistencyLevel
    ) external payable override returns (uint64 sequence) {
        emit WormholeSendMessageKey(
            targetChain,
            targetAddress,
            payload,
            receiverValue,
            paymentForExtraReceiverValue,
            gasLimit,
            refundChain,
            refundAddress,
            deliveryProviderAddress,
            messageKeys,
            consistencyLevel
        );
        return _sequence;
    }

    function send(
        uint16,
        bytes32,
        bytes memory,
        uint256,
        uint256,
        bytes memory,
        uint16,
        bytes32,
        address,
        VaaKey[] memory,
        uint8
    ) external payable override returns (uint64 sequence) {}

    function send(
        uint16,
        bytes32,
        bytes memory,
        uint256,
        uint256,
        bytes memory,
        uint16,
        bytes32,
        address,
        MessageKey[] memory,
        uint8
    ) external payable override returns (uint64 sequence) {}

    function resendToEvm(
        VaaKey memory,
        uint16,
        uint256,
        uint256,
        address
    ) external payable override returns (uint64 sequence) {}

    function resend(
        VaaKey memory,
        uint16,
        uint256,
        bytes memory,
        address
    ) external payable override returns (uint64 sequence) {}

    function quoteEVMDeliveryPrice(
        uint16,
        uint256 receiverValue,
        uint256 gasLimit
    ) external pure override returns (uint256 nativePriceQuote, uint256 targetChainRefundPerGasUnused) {
        nativePriceQuote = receiverValue + gasLimit;
        targetChainRefundPerGasUnused = 0;
    }

    function quoteEVMDeliveryPrice(
        uint16,
        uint256 receiverValue,
        uint256 gasLimit,
        address
    ) external pure override returns (uint256 nativePriceQuote, uint256 targetChainRefundPerGasUnused) {
        nativePriceQuote = receiverValue + gasLimit;
        targetChainRefundPerGasUnused = 0;
    }

    function quoteDeliveryPrice(
        uint16,
        uint256,
        bytes memory,
        address
    ) external view override returns (uint256 nativePriceQuote, bytes memory encodedExecutionInfo) {}

    function quoteNativeForChain(uint16, uint256, address) external view override returns (uint256 targetChainAmount) {}

    function getDefaultDeliveryProvider() external view override returns (address deliveryProvider) {}

    function deliverToAdapter(
        IWormholeReceiver adapter,
        bytes memory payload,
        bytes[] memory additionalMessages,
        bytes32 sourceAddress,
        uint16 sourceChain,
        bytes32 deliveryHash
    ) external payable {
        adapter.receiveWormholeMessages{ value: msg.value }(
            payload,
            additionalMessages,
            sourceAddress,
            sourceChain,
            deliveryHash
        );
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@solidity-bytes-utils/contracts/BytesLib.sol";

import "./Messages.sol";

library CCIPTokenMessages {
    using BytesLib for bytes;

    struct CCIPTokenMetadata {
        uint256 amount;
        bytes32 token;
        bytes32 recipient;
        Messages.MessageMetadata messageMetadata;
    }

    function encodePayloadWithCCIPTokenMetadata(
        uint256 amount,
        bytes32 token,
        bytes32 recipient,
        Messages.MessageToSend memory message
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                amount,
                token,
                recipient,
                message.params.returnAdapterId,
                message.params.returnGasLimit,
                message.sender,
                message.handler,
                message.payload
            );
    }

    function decodePayloadWithCCIPTokenMetadata(
        bytes memory serialized
    ) internal pure returns (CCIPTokenMetadata memory ccipMessageMetadata, bytes memory payload) {
        uint256 index = 0;
        ccipMessageMetadata.amount = serialized.toUint256(index);
        index += 32;
        ccipMessageMetadata.token = serialized.toBytes32(index);
        index += 32;
        ccipMessageMetadata.recipient = serialized.toBytes32(index);
        index += 32;

        Messages.MessageMetadata memory metadata;
        metadata.returnAdapterId = serialized.toUint16(index);
        index += 2;
        metadata.returnGasLimit = serialized.toUint256(index);
        index += 32;
        metadata.sender = serialized.toBytes32(index);
        index += 32;
        metadata.handler = serialized.toBytes32(index);
        index += 32;
        ccipMessageMetadata.messageMetadata = metadata;

        payload = serialized.slice(index, serialized.length - index);
    }
}

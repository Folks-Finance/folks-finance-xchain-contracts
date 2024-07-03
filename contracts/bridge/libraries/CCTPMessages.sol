// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@solidity-bytes-utils/contracts/BytesLib.sol";

import "./Messages.sol";

library CCTPMessages {
    using BytesLib for bytes;

    struct CCTPMetadata {
        uint32 sourceDomainId;
        uint256 amount;
        uint64 nonce;
        bytes32 recipient;
        Messages.MessageMetadata messageMetadata;
    }

    function encodePayloadWithCCTPMetadata(
        uint32 sourceDomainId,
        uint256 amount,
        uint64 nonce,
        bytes32 recipient,
        Messages.MessageToSend memory message
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                sourceDomainId,
                amount,
                nonce,
                recipient,
                message.params.returnAdapterId,
                message.params.returnGasLimit,
                message.sender,
                message.handler,
                message.payload
            );
    }

    function decodePayloadWithCCTPMetadata(
        bytes memory serialized
    ) internal pure returns (CCTPMetadata memory cctpMessageMetadata, bytes memory payload) {
        uint256 index = 0;
        cctpMessageMetadata.sourceDomainId = serialized.toUint32(index);
        index += 4;
        cctpMessageMetadata.amount = serialized.toUint256(index);
        index += 32;
        cctpMessageMetadata.nonce = serialized.toUint64(index);
        index += 8;
        cctpMessageMetadata.recipient = serialized.toBytes32(index);
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
        cctpMessageMetadata.messageMetadata = metadata;

        payload = serialized.slice(index, serialized.length - index);
    }

    function getNonceFromCCTPMessage(bytes memory message) internal pure returns (uint64) {
        uint256 cctp_nonce_index = 12;
        return message.toUint64(cctp_nonce_index);
    }
}

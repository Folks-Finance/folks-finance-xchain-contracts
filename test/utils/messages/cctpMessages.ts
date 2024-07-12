import { ethers } from "hardhat";
import {
  BYTES32_LENGTH,
  UINT16_LENGTH,
  UINT256_LENGTH,
  UINT32_LENGTH,
  UINT64_LENGTH,
  convertEVMAddressToGenericAddress,
  convertNumberToBytes,
} from "../bytes";
import { MessageToSend, MessageMetadata, checkAddressFormat } from "./messages";

export function encodePayloadWithCCTPMetadata(
  sourceDomainId: number | bigint,
  amount: bigint,
  nonce: number | bigint,
  recipientAddr: string,
  message: MessageToSend
): string {
  if (!checkAddressFormat(recipientAddr)) throw Error("Unknown recipient address format");

  return ethers.concat([
    convertNumberToBytes(sourceDomainId, UINT32_LENGTH),
    convertNumberToBytes(amount, UINT256_LENGTH),
    convertNumberToBytes(nonce, UINT64_LENGTH),
    convertEVMAddressToGenericAddress(recipientAddr),
    convertNumberToBytes(message.params.returnAdapterId, UINT16_LENGTH),
    convertNumberToBytes(message.params.returnGasLimit, UINT256_LENGTH),
    message.sender,
    message.handler,
    message.payload,
  ]);
}

export interface CCTPMetadata {
  sourceDomainId: bigint;
  amount: bigint;
  nonce: bigint;
  recipient: string;
  messageMetadata: MessageMetadata;
}

export interface PayloadWithCCTPMetadata {
  metadata: CCTPMetadata;
  payload: string;
}

export function decodePayloadWithCCTPMetadata(serialised: string): PayloadWithCCTPMetadata {
  let index = 0;
  const sourceDomainId = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT32_LENGTH), 16));
  index += UINT32_LENGTH;
  const amount = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT256_LENGTH), 16));
  index += UINT256_LENGTH;
  const nonce = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT64_LENGTH), 16));
  index += UINT64_LENGTH;
  const recipient = ethers.dataSlice(serialised, index, index + BYTES32_LENGTH);
  index += BYTES32_LENGTH;
  const returnAdapterId = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT16_LENGTH), 16));
  index += UINT16_LENGTH;
  const returnGasLimit = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT256_LENGTH), 16));
  index += UINT256_LENGTH;
  const sender = ethers.dataSlice(serialised, index, index + BYTES32_LENGTH);
  index += BYTES32_LENGTH;
  const handler = ethers.dataSlice(serialised, index, index + BYTES32_LENGTH);
  index += BYTES32_LENGTH;
  const payload = ethers.dataSlice(serialised, index);
  return {
    metadata: {
      sourceDomainId,
      amount,
      nonce,
      recipient,
      messageMetadata: { returnAdapterId, returnGasLimit, sender, handler },
    },
    payload,
  };
}

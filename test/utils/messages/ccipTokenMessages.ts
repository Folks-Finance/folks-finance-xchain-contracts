import { ethers } from "hardhat";
import {
  BYTES32_LENGTH,
  UINT16_LENGTH,
  UINT256_LENGTH,
  convertEVMAddressToGenericAddress,
  convertNumberToBytes,
} from "../bytes";
import { MessageToSend, MessageMetadata, checkAddressFormat } from "./messages";

export function encodePayloadWithCCIPTokenMetadata(
  amount: bigint,
  tokenAddr: string,
  recipientAddr: string,
  message: MessageToSend
): string {
  if (!checkAddressFormat(tokenAddr)) throw Error("Unknown token address format");
  if (!checkAddressFormat(recipientAddr)) throw Error("Unknown recipient address format");

  return ethers.concat([
    convertNumberToBytes(amount, UINT256_LENGTH),
    convertEVMAddressToGenericAddress(tokenAddr),
    convertEVMAddressToGenericAddress(recipientAddr),
    convertNumberToBytes(message.params.returnAdapterId, UINT16_LENGTH),
    convertNumberToBytes(message.params.returnGasLimit, UINT256_LENGTH),
    message.sender,
    message.handler,
    message.payload,
  ]);
}

export interface CCIPTokenMetadata {
  amount: bigint;
  token: string;
  recipient: string;
  messageMetadata: MessageMetadata;
}

export interface PayloadWithCCIPTokenMetadata {
  metadata: CCIPTokenMetadata;
  payload: string;
}

export function decodePayloadWithCCIPTokenMetadata(serialised: string): PayloadWithCCIPTokenMetadata {
  let index = 0;
  const amount = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT256_LENGTH), 16));
  index += UINT256_LENGTH;
  const token = ethers.dataSlice(serialised, index, index + BYTES32_LENGTH);
  index += BYTES32_LENGTH;
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
    metadata: { amount, token, recipient, messageMetadata: { returnAdapterId, returnGasLimit, sender, handler } },
    payload,
  };
}

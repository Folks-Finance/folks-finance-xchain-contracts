import { ethers } from "hardhat";
import {
  BYTES32_LENGTH,
  EVM_ADDRESS_BYTES_LENGTH,
  UINT16_LENGTH,
  UINT256_LENGTH,
  convertEVMAddressToGenericAddress,
  convertNumberToBytes,
} from "../bytes";

const abi = ethers.AbiCoder.defaultAbiCoder();
export interface MessageParams {
  adapterId: bigint;
  returnAdapterId: bigint;
  receiverValue: bigint;
  gasLimit: bigint;
  returnGasLimit: bigint;
}

export interface MessageToSend {
  params: MessageParams;
  sender: string;
  destinationChainId: bigint;
  handler: string;
  payload: string;
  finalityLevel: number;
  extraArgs: string;
}

export interface MessageReceived {
  messageId: string;
  sourceChainId: bigint;
  sourceAddress: string;
  handler: string;
  payload: string;
  returnAdapterId: bigint;
  returnGasLimit: bigint;
}

export function extraArgsToBytes(tokenAddr: string, recipientAddr: string, amount: bigint) {
  if (!checkAddressFormat(tokenAddr)) throw Error("Unknown token address format");
  if (!checkAddressFormat(recipientAddr)) throw Error("Unknown recipient address format");

  return ethers.concat([
    "0x1b366e79",
    convertEVMAddressToGenericAddress(tokenAddr),
    convertEVMAddressToGenericAddress(recipientAddr),
    convertNumberToBytes(amount, UINT256_LENGTH),
  ]);
}

export interface CCIPMessageReceived {
  messageId: string;
  sourceChainSelector: bigint;
  sender: string;
  data: string;
  destTokenAmounts: {
    token: string;
    amount: bigint;
  }[];
}

export enum Finality {
  IMMEDIATE = 0,
  FINALISED = 1,
}

export enum Action {
  // SPOKE -> HUB
  CreateAccount,
  InviteAddress,
  AcceptInviteAddress,
  UnregisterAddress,
  AddDelegate,
  RemoveDelegate,
  CreateLoan,
  DeleteLoan,
  CreateLoanAndDeposit,
  Deposit,
  DepositFToken,
  Withdraw,
  WithdrawFToken,
  Borrow,
  Repay,
  RepayWithCollateral,
  Liquidate,
  SwitchBorrowType,
  // HUB -> SPOKE
  SendToken,
}

export interface MessagePayload {
  action: Action;
  accountId: string;
  userAddress: string;
  data: string;
}

export function checkAddressFormat(addr: string): boolean {
  const hexAddressLength = 2 * EVM_ADDRESS_BYTES_LENGTH + "0x".length;
  return ethers.isHexString(addr) && addr.length === hexAddressLength && ethers.isAddress(addr);
}

function checkAccountFormat(accountId: string): boolean {
  const accoundIdLength = 2 * BYTES32_LENGTH + "0x".length;
  return ethers.isHexString(accountId) && accountId.length === accoundIdLength;
}

export function buildMessagePayload(action: Action, accountId: string, userAddr: string, data: string): string {
  if (!checkAccountFormat(accountId)) throw Error("Unknown account id format");
  if (!checkAddressFormat(userAddr)) throw Error("Unknown user address format");
  if (!ethers.isHexString(data)) throw Error("Unknown data format");

  return ethers.concat([
    convertNumberToBytes(action, UINT16_LENGTH),
    accountId,
    convertEVMAddressToGenericAddress(userAddr),
    data,
  ]);
}

export function encodePayloadWithMetadata(message: MessageToSend): string {
  return ethers.concat([
    convertNumberToBytes(message.params.returnAdapterId, UINT16_LENGTH),
    convertNumberToBytes(message.params.returnGasLimit, UINT256_LENGTH),
    message.sender,
    message.handler,
    message.payload,
  ]);
}

export interface MessageMetadata {
  returnAdapterId: bigint;
  returnGasLimit: bigint;
  sender: string;
  handler: string;
}

export interface PayloadWithMetadata {
  metadata: MessageMetadata;
  payload: string;
}

export function decodePayloadWithMetadata(serialised: string): PayloadWithMetadata {
  let index = 0;
  const returnAdapterId = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT16_LENGTH), 16));
  index += UINT16_LENGTH;
  const returnGasLimit = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT256_LENGTH), 16));
  index += UINT256_LENGTH;
  const sender = ethers.dataSlice(serialised, index, index + BYTES32_LENGTH);
  index += BYTES32_LENGTH;
  const handler = ethers.dataSlice(serialised, index, index + BYTES32_LENGTH);
  index += BYTES32_LENGTH;
  const payload = ethers.dataSlice(serialised, index);
  return { metadata: { returnAdapterId, returnGasLimit, sender, handler }, payload };
}

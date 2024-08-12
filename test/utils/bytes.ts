import { ethers } from "hardhat";

export const UINT8_LENGTH = 1;
export const UINT16_LENGTH = 2;
export const UINT32_LENGTH = 4;
export const UINT64_LENGTH = 8;
export const UINT256_LENGTH = 32;
export const BYTES4_LENGTH = 4;
export const BYTES32_LENGTH = 32;

export const EVM_ADDRESS_BYTES_LENGTH = 20;

export const abiCoder = ethers.AbiCoder.defaultAbiCoder();

export function getEmptyBytes(length: number): string {
  return ethers.zeroPadBytes("0x", length);
}

export function convertEVMAddressToGenericAddress(address: string): string {
  return ethers.zeroPadValue(address, BYTES32_LENGTH);
}

export function convertGenericAddressToEVMAddress(address: string): string {
  return ethers.getAddress(ethers.dataSlice(address, BYTES32_LENGTH - EVM_ADDRESS_BYTES_LENGTH));
}

export function getAccountIdBytes(accountId: string): string {
  return ethers.zeroPadValue(ethers.hexlify(Buffer.from(accountId)), BYTES32_LENGTH);
}

export function generateAccountId(addr: string, chainId: number | bigint, nonce: string): string {
  return ethers.keccak256(
    ethers.concat([convertEVMAddressToGenericAddress(addr), convertNumberToBytes(chainId, UINT16_LENGTH), nonce])
  );
}

export function generateLoanId(accountId: string, nonce: string): string {
  return ethers.keccak256(ethers.concat([accountId, nonce]));
}

export function convertNumberToBytes(num: number | bigint, length: number): string {
  // insert 0s at the beginning if data is smaller than length bytes
  const buf = Buffer.alloc(length, 0);

  // convert num to bytes
  const hex = num.toString(16);
  const isEven = hex.length % 2 === 0;
  const bytes = Buffer.from(isEven ? hex : "0" + hex, "hex");

  // write bytes to fixed length buf
  bytes.copy(buf, buf.length - bytes.length);
  return ethers.hexlify(buf);
}

export function convertStringToBytes(str: string): string {
  return ethers.hexlify("0x" + Buffer.from(str).toString("hex"));
}

export function convertBooleanToByte(bool: boolean): string {
  return bool ? "0x01" : "0x00";
}

export function getRandomBytes(length: number): string {
  return ethers.hexlify(ethers.randomBytes(length));
}

export function getRandomAddress(): string {
  return ethers.getAddress(getRandomBytes(EVM_ADDRESS_BYTES_LENGTH));
}

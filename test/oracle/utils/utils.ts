import { ethers } from "hardhat";
import { NodeDefinition } from "../../../typechain-types/contracts/oracle/modules/NodeManager";

export const abi = ethers.AbiCoder.defaultAbiCoder();

export const PRECISION = 18;

export function getOracleNodeId(nodeType: any, parameters: any, parents: any) {
  const encodedData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes", "bytes32[]"],
    [nodeType, parameters, parents]
  );
  const hash = ethers.keccak256(encodedData);
  return hash;
}

export function getConstantNodePrice(nodeDefinition: NodeDefinition.DataStructOutput) {
  const price = ethers.AbiCoder.defaultAbiCoder().decode(["int256"], nodeDefinition.parameters)[0];
  return price;
}

export async function deployMockChainlinkAggregator(decimals: number, prices: bigint[], timestampDeltas: number[]) {
  const MockChainlinkAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
  const mockChainlinkAggregator = await MockChainlinkAggregator.deploy(decimals, prices, timestampDeltas);
  await mockChainlinkAggregator.waitForDeployment();
  const deployBlock = mockChainlinkAggregator.deploymentTransaction()?.blockNumber as number;
  const blockInfo = await ethers.provider.getBlock(deployBlock);
  const deployBlockTimestamp = blockInfo?.timestamp as number;
  return { mockChainlinkAggregator, deployBlockTimestamp };
}

export const getRandomPriceInRangeWithDp = (min: number, max: number, dp: number) =>
  BigInt(Math.floor((Math.random() * (max - min) + min) * 10 ** dp));

export const priceToPrecisionDp = (price: bigint, decimals: number, precision: number) =>
  precision > decimals
    ? price * BigInt(10) ** BigInt(precision - decimals)
    : price / BigInt(10) ** BigInt(decimals - precision);

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

export async function deployMockChainlinkAggregator(
  decimals: number,
  prices: [number, number, number, number, number],
  timestampDeltas: [number, number, number, number, number]
) {
  const MockChainlinkAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
  const mockChainlinkAggregator = await MockChainlinkAggregator.deploy(decimals, prices, timestampDeltas);
  await mockChainlinkAggregator.waitForDeployment();
  const deployBlock = mockChainlinkAggregator.deploymentTransaction()?.blockNumber as number;
  const blockInfo = await ethers.provider.getBlock(deployBlock);
  const deployBlockTimestamp = blockInfo?.timestamp as number;
  return { mockChainlinkAggregator, deployBlockTimestamp };
}

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import { NodeManager } from "../../typechain-types";

export async function deployNodeManagerFixture() {
  const NodeManager = await ethers.getContractFactory("NodeManager");
  const nodeManager = await NodeManager.deploy();
  return { nodeManager };
}

export function bootstrapNodeManager() {
  let nodeManager: NodeManager;

  beforeEach("Deploy NodeManager contract", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));
  });

  return { nodeManagerContract: () => nodeManager };
}

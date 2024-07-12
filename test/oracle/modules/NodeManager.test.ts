import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import NodeType from "../assets/NodeType";
import { abi, getOracleNodeId } from "../utils/utils";
import { NodeManager } from "../../../typechain-types";

async function deployNodeManagerFixture() {
  const NodeManager = await ethers.getContractFactory("NodeManager");
  const nodeManager = await NodeManager.deploy();
  return { nodeManager };
}

describe("NodeManager", async function () {
  let nodeManager: NodeManager;

  beforeEach("Deploy NodeManager contract", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));
  });

  describe("Deployment", async function () {
    it("Should have an address", async function () {
      expect(nodeManager.getAddress()).to.not.equal(0);
    });
  });

  describe("Register Node", async function () {
    it("Should emit NodeRegistered", async function () {
      const [type, parameters, parents] = [NodeType.CONSTANT, abi.encode(["uint256"], ["1"]), []];
      const nodeId = getOracleNodeId(type, parameters, parents);

      const registerNode = nodeManager.registerNode(type, parameters, parents);

      await expect(registerNode).to.emit(nodeManager, "NodeRegistered").withArgs(nodeId, type, parameters, parents);
    });

    it("Should revert cause InvalidNodeDefinition", async function () {
      const [type, parameters, parents] = [NodeType.CONSTANT, "0x00", []];
      const nodeId = getOracleNodeId(type, parameters, parents);

      const registerNode = nodeManager.registerNode(type, parameters, parents);

      await expect(registerNode)
        .to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition")
        .withArgs([type, parameters, parents]);
    });

    it("Should revert cause parent NodeNotRegistered", async function () {
      const parentOneNodeId = getOracleNodeId(NodeType.CONSTANT, abi.encode(["string"], ["A"]), []);
      const parentTwoNodeId = getOracleNodeId(NodeType.CONSTANT, abi.encode(["string"], ["B"]), []);
      const [type, parameters, parents] = [
        NodeType.REDUCER,
        abi.encode(["uint256"], ["0"]),
        [parentOneNodeId, parentTwoNodeId],
      ];

      const registerNode = nodeManager.registerNode(type, parameters, parents);

      await expect(registerNode)
        .to.be.revertedWithCustomError(nodeManager, "NodeNotRegistered")
        .withArgs(parentOneNodeId);
    });
  });
});

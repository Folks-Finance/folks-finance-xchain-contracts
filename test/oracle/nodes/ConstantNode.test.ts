import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { NodeManager } from "../../../typechain-types";
import NodeType from "../assets/NodeType";
import { deployNodeManagerFixture } from "../bootstrap";
import { NodeManagerUtil } from "../utils/nodeManagerUtils";
import { abi, getOracleNodeId } from "../utils/utils";

describe("ConstantNode", async function () {
  let nodeManager: NodeManager;

  beforeEach("Deploy NodeManager contract", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));
  });

  describe("Register node", async function () {
    it("Should register a ConstantNode", async function () {
      const encodedParams = abi.encode(["uint256"], ["1"]);
      const registerTxn = await nodeManager.registerNode(NodeType.CONSTANT, encodedParams, []);
      await registerTxn.wait();

      const nodeId = getOracleNodeId(NodeType.CONSTANT, encodedParams, []);
      const node = await nodeManager.getNode(nodeId);

      expect(node.nodeType).to.equal(NodeType.CONSTANT);
      expect(node.parameters).to.equal(encodedParams);
      expect(node.parents).to.deep.equal([]);
    });

    it("Should emit InvalidNodeDefinition cause parameters length is not 32", async function () {
      const encodedParams = "0x00";

      const registerTxn = nodeManager.registerNode(NodeType.CONSTANT, encodedParams, []);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should emit InvalidNodeDefinition cause has parent node", async function () {
      const encodedParams = abi.encode(["uint256"], ["1"]);
      const fakeParent = ethers.encodeBytes32String("FakeParent");

      const registerTxn = nodeManager.registerNode(NodeType.CONSTANT, encodedParams, [fakeParent]);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });
  });

  describe("Contract methods", async function () {
    let price: number;
    let nodeId: string;

    beforeEach("Register ConstantNode", async function () {
      price = 1;
      const encodedParams = NodeManagerUtil.encodeConstantNodeDefinition(price);
      nodeId = await NodeManagerUtil.registerNode(nodeManager, encodedParams);
    });

    it("Should process correctly", async function () {
      const nodeOutput = await nodeManager.process(nodeId);

      expect(nodeOutput.price).to.equal(price);
      expect(nodeOutput.additionalParam1).to.equal(0);
      expect(nodeOutput.additionalParam2).to.equal(0);
    });
  });
});

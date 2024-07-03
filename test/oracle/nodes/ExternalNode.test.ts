import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { MockConstantPriceAndTimestampNode, MockNoIERC165, MockNoValid, NodeManager } from "../../../typechain-types";
import NodeType from "../assets/NodeType";
import { deployNodeManagerFixture } from "../bootstrap";
import { NodeManagerUtil } from "../utils/nodeManagerUtils";
import { abi, getOracleNodeId } from "../utils/utils";

describe("ExternalNode", async function () {
  let nodeManager: NodeManager;
  let price: number;
  let timestamp: number;

  beforeEach("Deploy NodeManager", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));
  });

  describe("ExternalNode with MockConstantPriceAndTimestampNode", async function () {
    let mockConstantPriceAndTimestampNode: MockConstantPriceAndTimestampNode;

    beforeEach("Deploy MockConstantPriceAndTimestampNode contract", async function () {
      const MockConstantPriceAndTimestampNode = await ethers.getContractFactory("MockConstantPriceAndTimestampNode");
      price = 42;
      timestamp = 69420;
      mockConstantPriceAndTimestampNode = await MockConstantPriceAndTimestampNode.deploy(price, timestamp);
      await mockConstantPriceAndTimestampNode.waitForDeployment();
    });

    describe("Register node", async function () {
      it("Should register a constant price and timestamp node", async function () {
        const nodeAddress = await mockConstantPriceAndTimestampNode.getAddress();
        const encodedNodeAddress = abi.encode(["address"], [nodeAddress]);

        const registerTxn = await nodeManager.registerNode(NodeType.EXTERNAL, encodedNodeAddress, []);
        await registerTxn.wait();

        const nodeId = getOracleNodeId(NodeType.EXTERNAL, encodedNodeAddress, []);
        const node = await nodeManager.getNode(nodeId);
        expect(node.nodeType).to.equal(NodeType.EXTERNAL);
        expect(node.parameters).to.equal(encodedNodeAddress);
        expect(node.parents).to.deep.equal([]);
      });

      it("Should emit InvalidNodeDefinition cause parameters length is not 32", async function () {
        const encodedNodeAddress = "0x00";

        const registerTxn = nodeManager.registerNode(NodeType.EXTERNAL, encodedNodeAddress, []);

        await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
      });
    });

    describe("Contract methods", async function () {
      let nodeAddress: string;
      let nodeId: string;

      beforeEach("Register MockConstantPriceAndTimestampNode", async function () {
        nodeAddress = await mockConstantPriceAndTimestampNode.getAddress();
        const encodedNodeAddress = NodeManagerUtil.encodeExternalNodeDefinition(nodeAddress);
        nodeId = await NodeManagerUtil.registerNode(nodeManager, encodedNodeAddress);
      });

      it("Should process correctly", async function () {
        const nodeOutput = await nodeManager.process(nodeId);

        expect(nodeOutput.price).to.equal(price);
        expect(nodeOutput.timestamp).to.equal(timestamp);
      });
    });
  });

  describe("ExternalNode with MockNoIERC165", async function () {
    let mockNoIERC165: MockNoIERC165;

    beforeEach("Deploy MockNoIERC165 contract", async function () {
      const MockNoIERC165 = await ethers.getContractFactory("MockNoIERC165");
      price = 42;
      timestamp = 69420;
      mockNoIERC165 = await MockNoIERC165.deploy(price, timestamp);
      await mockNoIERC165.waitForDeployment();
    });

    it("Should emit InvalidNodeDefinition cause no IERC165", async function () {
      const nodeAddress = await mockNoIERC165.getAddress();
      const encodedNodeAddress = abi.encode(["address"], [nodeAddress]);

      const registerTxn = nodeManager.registerNode(NodeType.EXTERNAL, encodedNodeAddress, []);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });
  });

  describe("ExternalNode with MockNoValid", async function () {
    let mockNoValid: MockNoValid;

    beforeEach("Deploy MockNoValid contract", async function () {
      const MockNoValid = await ethers.getContractFactory("MockNoValid");
      price = 42;
      timestamp = 69420;
      mockNoValid = await MockNoValid.deploy(price, timestamp);
      await mockNoValid.waitForDeployment();
    });

    it("Should emit InvalidNodeDefinition cause no is Valid return false", async function () {
      const nodeAddress = await mockNoValid.getAddress();
      const encodedNodeAddress = abi.encode(["address"], [nodeAddress]);

      const registerTxn = nodeManager.registerNode(NodeType.EXTERNAL, encodedNodeAddress, []);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });
  });
});

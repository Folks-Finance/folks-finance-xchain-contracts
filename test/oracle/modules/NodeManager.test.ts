import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import { MockNodeManager__factory, NodeManager, NodeManager__factory } from "../../../typechain-types";
import NodeType from "../assets/NodeType";
import { abi, getOracleNodeId } from "../utils/utils";

async function deployNodeManagerFixture() {
  const [user] = await ethers.getSigners();
  const nodeManager = await new NodeManager__factory(user).deploy();
  return { user, nodeManager };
}

describe("NodeManager", async function () {
  let nodeManager: NodeManager;
  let user: Signer;

  beforeEach("Deploy NodeManager contract", async function () {
    ({ user, nodeManager } = await loadFixture(deployNodeManagerFixture));
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

  describe("SupportsInterface", function () {
    let IERC165Interface: string;
    let INodeManagerInterface: string;

    before("Deploy NodeManager Mock contract and get interfaces", async function () {
      const nodeManagerMock = await new MockNodeManager__factory(user).deploy();
      IERC165Interface = await nodeManagerMock.getERC165Selector();
      INodeManagerInterface = await nodeManagerMock.getINodeManagerInterface();
    });

    it("Should support ERC165 interface", async function () {
      expect(await nodeManager.supportsInterface(IERC165Interface)).to.be.true;
    });

    it("Should support INodeManager interface", async function () {
      expect(await nodeManager.supportsInterface(INodeManagerInterface)).to.be.true;
    });
  });
});

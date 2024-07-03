import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { MockConstantPriceAndTimestampNode, NodeManager } from "../../../typechain-types";
import NodeType from "../assets/NodeType";
import { deployNodeManagerFixture } from "../bootstrap";

const abi = ethers.AbiCoder.defaultAbiCoder();

describe("MockConstantPriceAndTimestampNode", async function () {
  let nodeManager: NodeManager;
  let mockConstantPriceAndTimestampNode: MockConstantPriceAndTimestampNode;

  beforeEach("Deploy NodeManager contract", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));
  });

  it("Should deploy a MockConstantPriceAndTimestampNode contract", async function () {
    const MockConstantPriceAndTimestampNode = await ethers.getContractFactory("MockConstantPriceAndTimestampNode");
    const price = 42;
    const timestamp = 69420;
    mockConstantPriceAndTimestampNode = await MockConstantPriceAndTimestampNode.deploy(price, timestamp);
    await mockConstantPriceAndTimestampNode.waitForDeployment();

    expect(await mockConstantPriceAndTimestampNode.getAddress()).to.not.NaN;
  });

  describe("Contract methods", async function () {
    let price: bigint;
    let timestamp: bigint;
    beforeEach("Deploy MockConstantPriceAndTimestampNode contract", async function () {
      const MockConstantPriceAndTimestampNode = await ethers.getContractFactory("MockConstantPriceAndTimestampNode");
      price = 42n;
      timestamp = 69420n;
      mockConstantPriceAndTimestampNode = await MockConstantPriceAndTimestampNode.deploy(price, timestamp);
      await mockConstantPriceAndTimestampNode.waitForDeployment();
    });

    it("Should returns true for isValid when nodeType is external", async function () {
      const nodeDefinition = {
        nodeType: NodeType.EXTERNAL,
        parameters: abi.encode(["address"], [await mockConstantPriceAndTimestampNode.getAddress()]),
        parents: [],
      };

      expect(await mockConstantPriceAndTimestampNode.isValid(nodeDefinition)).to.be.true;
    });

    it("Should returns false for isValid when nodeType is not external", async function () {
      const nodeDefinition = {
        nodeType: NodeType.CONSTANT,
        parameters: abi.encode(["address"], [await mockConstantPriceAndTimestampNode.getAddress()]),
        parents: [],
      };

      expect(await mockConstantPriceAndTimestampNode.isValid(nodeDefinition)).to.be.false;
    });

    it("Should returns default node output for process", async function () {
      const nodeOutput = await mockConstantPriceAndTimestampNode.process([], "0x");

      expect(nodeOutput.price).to.be.equal(price);
      expect(nodeOutput.timestamp).to.be.equal(timestamp);
      expect(nodeOutput.additionalParam1).to.be.equal(0);
      expect(nodeOutput.additionalParam2).to.be.equal(0);
    });
  });
});

import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { PRECISION, abi, getOracleNodeId } from "../utils/utils";
import NodeType from "../assets/NodeType";
import { deployNodeManagerFixture } from "../bootstrap";
import { NodeManagerUtil } from "../utils/nodeManagerUtils";
import { MockPythManager, NodeManager } from "../../../typechain-types";

describe("PythNode", async function () {
  const decimals = 8;

  let nodeManager: NodeManager;
  let mockPythManager: MockPythManager;
  let mockPythManagerAddress: string;
  let priceFeedId: string;
  let price: number;
  let confidence: number;
  let exponent: number;
  let emaPrice: number;
  let emaConfidence: number;
  let updateTimestamp: number;
  let prevUpdateTimestamp: number;
  let deployBlockTimestamp: number;

  beforeEach("Deploy NodeManager and MockPyth contracts and add priceId", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));

    const MockPythManager = await ethers.getContractFactory("MockPythManager");
    const validTimePeriod = 60;
    const singleUpdateFeeInWei = 1;
    mockPythManager = await MockPythManager.deploy(validTimePeriod, singleUpdateFeeInWei);
    await mockPythManager.waitForDeployment();
    mockPythManagerAddress = await mockPythManager.getAddress();
    const deployBlock = mockPythManager.deploymentTransaction()?.blockNumber as number;
    const blockInfo = await ethers.provider.getBlock(deployBlock);
    deployBlockTimestamp = blockInfo?.timestamp as number;

    priceFeedId = ethers.zeroPadBytes("0x42424242", 32);
    price = 420 * 10 ** decimals;
    confidence = 2;
    exponent = -decimals;
    emaPrice = 411 * 10 ** decimals;
    emaConfidence = 1;
    updateTimestamp = deployBlockTimestamp;
    prevUpdateTimestamp = deployBlockTimestamp - 60 * 60 * 24;

    const priceFeedData = await mockPythManager.createPriceFeedUpdateData(
      priceFeedId,
      price,
      confidence,
      exponent,
      emaPrice,
      emaConfidence,
      updateTimestamp,
      prevUpdateTimestamp
    );
    const fees = await mockPythManager.getUpdateFee([priceFeedData]);
    const updatePriceFeedRes = await mockPythManager.updatePriceFeeds([priceFeedData], { value: fees });
    await updatePriceFeedRes.wait();
  });

  describe("Register node", async function () {
    it("Should register a pyth node", async function () {
      const encodedParams = abi.encode(["address", "bytes32", "bool"], [mockPythManagerAddress, priceFeedId, true]);
      const registerTxn = await nodeManager.registerNode(NodeType.PYTH, encodedParams, []);
      await registerTxn.wait();

      const nodeId = getOracleNodeId(NodeType.PYTH, encodedParams, []);
      const node = await nodeManager.getNode(nodeId);

      expect(node.nodeType).to.equal(NodeType.PYTH);
      expect(node.parameters).to.equal(encodedParams);
      expect(node.parents).to.deep.equal([]);
    });

    it("Should emit InvalidNodeDefinition cause parameters length is not 32*3", async function () {
      const encodedParams = abi.encode(["address", "bytes32"], [mockPythManagerAddress, priceFeedId]);
      const registerTxn = nodeManager.registerNode(NodeType.PYTH, encodedParams, []);
      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should emit InvalidNodeDefinition cause has parent node", async function () {
      const encodedParams = abi.encode(["address", "bytes32", "bool"], [mockPythManagerAddress, priceFeedId, true]);
      const fakeParent = ethers.encodeBytes32String("FakeParent");
      const registerTxn = nodeManager.registerNode(NodeType.PYTH, encodedParams, [fakeParent]);
      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should revert cause pyth getPrice thrown an error", async function () {});
  });

  describe("Contract methods", async function () {
    let nodeId: string;
    let nodeIdWithEmaPrice: string;

    beforeEach("Register MockPyth", async function () {
      [nodeId, nodeIdWithEmaPrice] = await Promise.all(
        [false, true].map(async (useEmaPrice) => {
          const encodedParams = NodeManagerUtil.encodePythNodeDefinition(
            mockPythManagerAddress,
            priceFeedId,
            useEmaPrice
          );
          return await NodeManagerUtil.registerNode(nodeManager, encodedParams);
        })
      );
    });

    it("Should process price correctly with precision bigger than exponent", async function () {
      const nodeOutput = await nodeManager.process(nodeId);

      expect(nodeOutput.price).to.equal(ethers.parseUnits(price.toString(), PRECISION - decimals));
      expect(nodeOutput.timestamp).to.equal(updateTimestamp);
      expect(nodeOutput.additionalParam1).to.equal(0);
      expect(nodeOutput.additionalParam2).to.equal(0);
    });

    it("Should process price correctly with precision smaller than exponent", async function () {});

    it("Should process ema price correctly", async function () {
      const nodeOutput = await nodeManager.process(nodeIdWithEmaPrice);

      expect(nodeOutput.price).to.equal(ethers.parseUnits(emaPrice.toString(), PRECISION - decimals));
      expect(nodeOutput.timestamp).to.equal(updateTimestamp);
      expect(nodeOutput.additionalParam1).to.equal(0);
      expect(nodeOutput.additionalParam2).to.equal(0);
    });
  });
});

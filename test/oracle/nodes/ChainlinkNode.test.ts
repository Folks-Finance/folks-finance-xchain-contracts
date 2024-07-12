import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { MockChainlinkAggregator, NodeManager } from "../../../typechain-types";
import NodeType from "../assets/NodeType";
import { deployNodeManagerFixture } from "../bootstrap";
import { NodeManagerUtil } from "../utils/nodeManagerUtils";
import { PRECISION, abi, deployMockChainlinkAggregator, getOracleNodeId } from "../utils/utils";

describe("ChainlinkNode", async function () {
  let nodeManager: NodeManager;
  let mockChainlinkAggregator: MockChainlinkAggregator;
  let mockChainlinkAggregatorAddr: string;
  let deployBlockTimestamp: number;
  let decimals: number;
  let prices: [number, number, number, number, number];
  let timestampDeltas: [number, number, number, number, number];

  beforeEach("Deploy NodeManager and MockChainlinkAggregator contracts", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));

    decimals = 6;
    prices = [420e5, 426e5, 429e5, 431e5, 432e5];
    timestampDeltas = [60 * 25, 60 * 20, 60 * 15, 60 * 10, 0];
    ({ mockChainlinkAggregator, deployBlockTimestamp } = await deployMockChainlinkAggregator(
      decimals,
      prices,
      timestampDeltas
    ));
    mockChainlinkAggregatorAddr = await mockChainlinkAggregator.getAddress();
  });

  describe("Register node", async function () {
    it("Should register a chainlink node", async function () {
      const twapInterval = 0;
      const decimals = 6;
      const encodedParams = abi.encode(
        ["address", "uint256", "uint8"],
        [mockChainlinkAggregatorAddr, twapInterval, decimals]
      );
      const registerTxn = await nodeManager.registerNode(NodeType.CHAINLINK, encodedParams, []);
      await registerTxn.wait();

      const nodeId = getOracleNodeId(NodeType.CHAINLINK, encodedParams, []);
      const node = await nodeManager.getNode(nodeId);

      expect(node.nodeType).to.equal(NodeType.CHAINLINK);
      expect(node.parameters).to.equal(encodedParams);
      expect(node.parents).to.deep.equal([]);
    });

    it("Should emit InvalidNodeDefinition cause parameters length is not 32*3", async function () {
      const encodedNodeAddress = abi.encode(["address"], [mockChainlinkAggregatorAddr]);

      const registerTxn = nodeManager.registerNode(NodeType.CHAINLINK, encodedNodeAddress, []);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should emit InvalidNodeDefinition cause param decimals is not correct", async function () {
      const twapInterval = 0;
      const decimals = 0;
      const encodedParams = abi.encode(
        ["address", "uint256", "uint8"],
        [mockChainlinkAggregatorAddr, twapInterval, decimals]
      );

      const registerTxn = nodeManager.registerNode(NodeType.CHAINLINK, encodedParams, []);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should emit InvalidNodeDefinition cause has parent node", async function () {
      const twapInterval = 0;
      const decimals = 0;
      const encodedParams = abi.encode(
        ["address", "uint256", "uint8"],
        [mockChainlinkAggregatorAddr, twapInterval, decimals]
      );
      const fakeParent = ethers.encodeBytes32String("FakeParent");

      const registerTxn = nodeManager.registerNode(NodeType.CHAINLINK, encodedParams, [fakeParent]);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });
  });

  describe("Contract methods without TWAP", async function () {
    let twapInterval: number;
    let decimals: number;
    let nodeId: string;

    beforeEach("Register Chainlink node", async function () {
      twapInterval = 0;
      decimals = 6;
      prices = [420e5, 426e5, 429e5, 431e5, 432e5];
      timestampDeltas = [60 * 25, 60 * 20, 60 * 15, 60 * 10, 0];

      const encNodeNoTwapParams = NodeManagerUtil.encodeChainlinkNodeDefinition(
        mockChainlinkAggregatorAddr,
        twapInterval,
        decimals
      );
      nodeId = await NodeManagerUtil.registerNode(nodeManager, encNodeNoTwapParams);
    });

    it("Should process correctly without twap", async function () {
      const nodeOutput = await nodeManager.process(nodeId);

      expect(nodeOutput.price).to.equal(ethers.parseUnits(prices[prices.length - 1].toString(), PRECISION - decimals));
      expect(nodeOutput.timestamp).to.equal(deployBlockTimestamp - timestampDeltas[timestampDeltas.length - 1]);
      expect(nodeOutput.additionalParam1).to.equal(0);
      expect(nodeOutput.additionalParam2).to.equal(0);
    });

    it("Should process price correctly with precision bigger than decimals", async function () {});
    it("Should process twap price correctly with twap interval newer than first update", async function () {});
  });

  describe("Contract methods with TWAP", async function () {
    let mockChainlinkAggregator26Decimals;
    let mockChainlinkAggregator26DecimalsTimestamp: number;
    let twapInterval: number;
    let decimalsTwapNode: number;
    let nodeIdTwap: string;

    beforeEach("Register MockChainlinkAggregator with 20 decimals and register Chainlink node", async function () {
      twapInterval = 60 * 30;
      decimalsTwapNode = 20;

      const MockChainlinkAggregator26Decimals = await ethers.getContractFactory("MockChainlinkAggregator");
      prices = [420e5, 426e5, 429e5, 431e5, 432e5];
      timestampDeltas = [60 * 25, 60 * 20, 60 * 15, 60 * 10, 0];
      ({
        mockChainlinkAggregator: mockChainlinkAggregator26Decimals,
        deployBlockTimestamp: mockChainlinkAggregator26DecimalsTimestamp,
      } = await deployMockChainlinkAggregator(decimalsTwapNode, prices, timestampDeltas));

      const encNodeTwapParams = NodeManagerUtil.encodeChainlinkNodeDefinition(
        await mockChainlinkAggregator26Decimals.getAddress(),
        twapInterval,
        decimalsTwapNode
      );

      nodeIdTwap = await NodeManagerUtil.registerNode(nodeManager, encNodeTwapParams);
    });

    it("Should process correctly with twap", async function () {
      const twap = prices.reduce((a, b) => a + b, 0) / prices.length;

      const nodeOutput = await nodeManager.process(nodeIdTwap);

      expect(nodeOutput.price).to.equal(twap * 10 ** (PRECISION - decimalsTwapNode));
      expect(nodeOutput.timestamp).to.equal(
        mockChainlinkAggregator26DecimalsTimestamp - timestampDeltas[timestampDeltas.length - 1]
      );
      expect(nodeOutput.additionalParam1).to.equal(0);
      expect(nodeOutput.additionalParam2).to.equal(0);
    });

    it("Should process price correctly with precision bigger than decimals", async function () {});
    it("Should process twap price correctly with twap interval newer than first update", async function () {});
  });
});

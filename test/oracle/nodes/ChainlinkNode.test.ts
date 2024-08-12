import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { MockChainlinkAggregator, NodeManager } from "../../../typechain-types";
import NodeType from "../assets/NodeType";
import { deployNodeManagerFixture } from "../bootstrap";
import { NodeManagerUtil } from "../utils/nodeManagerUtils";
import {
  PRECISION,
  abi,
  deployMockChainlinkAggregator,
  getOracleNodeId,
  getRandomPriceInRangeWithDp,
  priceToPrecisionDp,
} from "../utils/utils";

const minPrice = 250;
const maxPrice = 251;

const decimalsArray = [6, 18, 26, 40];
const pricesCount = 10;

for (const decimals of decimalsArray) {
  const pricesWithTimestampDelta = Array.from(Array(pricesCount).keys()).map((index) => ({
    price: getRandomPriceInRangeWithDp(minPrice, maxPrice, decimals),
    timestampDelta: 60 * 5 * (pricesCount - index - 1),
  }));

  describe(`ChainlinkNode: feed decimals: ${decimals}`, async function () {
    let nodeManager: NodeManager;
    let mockChainlinkAggregator: MockChainlinkAggregator;
    let mockChainlinkAggregatorAddr: string;
    let deployBlockTimestamp: number;

    let prices: bigint[] = pricesWithTimestampDelta.map(({ price }) => price);
    let timestampDeltas: number[] = pricesWithTimestampDelta.map(({ timestampDelta }) => timestampDelta);

    beforeEach("Deploy NodeManager and MockChainlinkAggregator contracts", async function () {
      ({ nodeManager } = await loadFixture(deployNodeManagerFixture));

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

        const encodedParams = abi.encode(["address", "uint256"], [mockChainlinkAggregatorAddr, twapInterval]);
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

      it("Should emit InvalidNodeDefinition cause has parent node", async function () {
        const twapInterval = 0;

        const encodedParams = abi.encode(["address", "uint256"], [mockChainlinkAggregatorAddr, twapInterval]);
        const fakeParent = ethers.encodeBytes32String("FakeParent");

        const registerTxn = nodeManager.registerNode(NodeType.CHAINLINK, encodedParams, [fakeParent]);

        await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
      });
    });

    describe("Contract methods without TWAP", async function () {
      let twapInterval: number;
      let nodeId: string;

      beforeEach("Register Chainlink node", async function () {
        twapInterval = 0;

        const encNodeNoTwapParams = NodeManagerUtil.encodeChainlinkNodeDefinition(
          mockChainlinkAggregatorAddr,
          twapInterval
        );
        nodeId = await NodeManagerUtil.registerNode(nodeManager, encNodeNoTwapParams);
      });

      it("Should process correctly without twap", async function () {
        const nodeOutput = await nodeManager.process(nodeId);

        expect(nodeOutput.price).to.equal(priceToPrecisionDp(prices[prices.length - 1], decimals, PRECISION));
        expect(nodeOutput.timestamp).to.equal(deployBlockTimestamp - timestampDeltas[timestampDeltas.length - 1]);
        expect(nodeOutput.additionalParam1).to.equal(0);
        expect(nodeOutput.additionalParam2).to.equal(0);
      });

      it("Should process correctly without twap after decimals increased", async function () {
        const newDecimals = decimals + 3;
        await mockChainlinkAggregator.setDecimals(newDecimals);
        const nodeOutput = await nodeManager.process(nodeId);

        expect(nodeOutput.price).to.equal(priceToPrecisionDp(prices[prices.length - 1], newDecimals, PRECISION));
        expect(nodeOutput.timestamp).to.equal(deployBlockTimestamp - timestampDeltas[timestampDeltas.length - 1]);
        expect(nodeOutput.additionalParam1).to.equal(0);
        expect(nodeOutput.additionalParam2).to.equal(0);
      });

      it("Should process correctly without twap after decimals decreased", async function () {
        const newDecimals = decimals - 3;
        await mockChainlinkAggregator.setDecimals(newDecimals);
        const nodeOutput = await nodeManager.process(nodeId);

        expect(nodeOutput.price).to.equal(priceToPrecisionDp(prices[prices.length - 1], newDecimals, PRECISION));
        expect(nodeOutput.timestamp).to.equal(deployBlockTimestamp - timestampDeltas[timestampDeltas.length - 1]);
        expect(nodeOutput.additionalParam1).to.equal(0);
        expect(nodeOutput.additionalParam2).to.equal(0);
      });
    });

    for (let twapInterval of timestampDeltas.filter((timestampDelta) => timestampDelta > 0)) {
      describe(`Contract methods with twapInterval: ${twapInterval}`, async function () {
        let mockChainlinkAggregator: MockChainlinkAggregator;
        let deployBlockTimestamp: number;
        let nodeIdTwap: string;

        beforeEach("Register MockChainlinkAggregator and register Chainlink node", async function () {
          const MockChainlinkAggregator26Decimals = await ethers.getContractFactory("MockChainlinkAggregator");
          ({ mockChainlinkAggregator, deployBlockTimestamp } = await deployMockChainlinkAggregator(
            decimals,
            prices,
            timestampDeltas
          ));

          const encNodeTwapParams = NodeManagerUtil.encodeChainlinkNodeDefinition(
            await mockChainlinkAggregator.getAddress(),
            twapInterval
          );

          nodeIdTwap = await NodeManagerUtil.registerNode(nodeManager, encNodeTwapParams);
        });

        it("Should process correctly with twap", async function () {
          const filteredPrices = pricesWithTimestampDelta
            .filter((pricesWithTimestampDelta) => pricesWithTimestampDelta.timestampDelta < twapInterval)
            .map(({ price }) => price);

          const twap = filteredPrices.reduce((a, b) => a + b, 0n) / BigInt(filteredPrices.length);

          const nodeOutput = await nodeManager.process(nodeIdTwap);

          expect(nodeOutput.price).to.equal(priceToPrecisionDp(twap, decimals, PRECISION));
          expect(nodeOutput.timestamp).to.equal(deployBlockTimestamp - timestampDeltas[timestampDeltas.length - 1]);
          expect(nodeOutput.additionalParam1).to.equal(0);
          expect(nodeOutput.additionalParam2).to.equal(0);
        });

        it("Should process correctly with twap when there is missing roundId", async function () {
          const pricesWithTimestampDeltaClone = structuredClone(pricesWithTimestampDelta);
          pricesWithTimestampDeltaClone[pricesCount - 2].price = 0n;
          // set price to 0 so it will revert
          await mockChainlinkAggregator.setPrice(0, pricesCount - 2);

          const filteredPrices = pricesWithTimestampDeltaClone
            .filter(
              (priceWithTimestampDelta) =>
                priceWithTimestampDelta.timestampDelta < twapInterval && priceWithTimestampDelta.price !== 0n
            )
            .map(({ price }) => price);

          const twap = filteredPrices.reduce((a, b) => a + b, 0n) / BigInt(filteredPrices.length);

          const nodeOutput = await nodeManager.process(nodeIdTwap);

          expect(nodeOutput.price).to.equal(priceToPrecisionDp(twap, decimals, PRECISION));
          expect(nodeOutput.timestamp).to.equal(deployBlockTimestamp - timestampDeltas[timestampDeltas.length - 1]);
          expect(nodeOutput.additionalParam1).to.equal(0);
          expect(nodeOutput.additionalParam2).to.equal(0);
        });
      });
    }
  });
}

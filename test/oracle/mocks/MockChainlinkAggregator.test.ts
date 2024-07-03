import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { MockChainlinkAggregator, NodeManager } from "../../../typechain-types";
import { deployNodeManagerFixture } from "../bootstrap";

const abi = ethers.AbiCoder.defaultAbiCoder();

describe("MockChainlinkAggregator", async function () {
  let nodeManager: NodeManager;
  let mockChainlinkAggregator: MockChainlinkAggregator;

  beforeEach("Deploy NodeManager contract", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));
  });

  it("Should deploy a MockChainlinkAggregator contract", async function () {
    const MockChainlinkAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
    const decimals: number = 6;
    const prices: [number, number, number, number, number] = [420e5, 426e5, 429e5, 431e5, 432e5];
    const timestampDeltas: [number, number, number, number, number] = [60 * 25, 60 * 20, 60 * 15, 60 * 10, 60];
    mockChainlinkAggregator = await MockChainlinkAggregator.deploy(decimals, prices, timestampDeltas);
    await mockChainlinkAggregator.waitForDeployment();

    expect(await mockChainlinkAggregator.getAddress()).to.not.NaN;
  });

  describe("Contract methods", async function () {
    let decimals: number;
    let prices: [number, number, number, number, number];
    let timestampDeltas: [number, number, number, number, number];
    beforeEach("Deploy MockChainlinkAggregator contract", async function () {
      const MockChainlinkAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
      decimals = 6;
      prices = [420e5, 426e5, 429e5, 431e5, 432e5];
      timestampDeltas = [60 * 25, 60 * 20, 60 * 15, 60 * 10, 60];
      mockChainlinkAggregator = await MockChainlinkAggregator.deploy(decimals, prices, timestampDeltas);
      await mockChainlinkAggregator.waitForDeployment();
    });
  });
});

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SpokeState__factory } from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertStringToBytes,
  getEmptyBytes,
  getRandomAddress,
} from "../utils/bytes";
import { SECONDS_IN_DAY } from "../utils/time";

describe("SpokeState contract (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const CONFIG_CONTRACTS_ROLE = ethers.keccak256(convertStringToBytes("CONFIG_CONTRACTS"));

  async function deploySpokeStateFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy spoke state
    const hubChainId = 0;
    const hubAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    const addressOracle = getRandomAddress();
    const spokeState = await new SpokeState__factory(user).deploy(admin, hubChainId, hubAddress, addressOracle);

    return { admin, user, unusedUsers, spokeState, hubChainId, hubAddress, addressOracle };
  }

  describe("Deployment", () => {
    it("Should set admin and contracts correctly", async () => {
      const { admin, spokeState, hubChainId, hubAddress, addressOracle } = await loadFixture(deploySpokeStateFixture);

      // check default admin role
      expect(await spokeState.owner()).to.equal(admin.address);
      expect(await spokeState.defaultAdmin()).to.equal(admin.address);
      expect(await spokeState.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await spokeState.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeState.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check config contracts role
      expect(await spokeState.getRoleAdmin(CONFIG_CONTRACTS_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeState.hasRole(CONFIG_CONTRACTS_ROLE, admin.address)).to.be.true;

      // check state
      expect(await spokeState.getHubChainId()).to.equal(hubChainId);
      expect(await spokeState.getHubContractAddress()).to.equal(hubAddress);
      expect(await spokeState.getAddressOracle()).to.equal(addressOracle);
    });
  });

  describe("Config Contracts", () => {
    it("Should succesfully set hub", async () => {
      const { admin, spokeState } = await loadFixture(deploySpokeStateFixture);

      // set hub
      const hubChainId = 1;
      const hubAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      await spokeState.connect(admin).setHub(hubChainId, hubAddress);
      expect(await spokeState.getHubChainId()).to.equal(hubChainId);
      expect(await spokeState.getHubContractAddress()).to.equal(hubAddress);
    });

    it("Should succesfully set address oracle", async () => {
      const { admin, spokeState } = await loadFixture(deploySpokeStateFixture);

      // set address oracle
      const addressOracle = getRandomAddress();
      await spokeState.connect(admin).setAddressOracle(addressOracle);
      expect(await spokeState.getAddressOracle()).to.equal(addressOracle);
    });

    it("Should fail to set hub when sender is not config admin", async () => {
      const { user, spokeState } = await loadFixture(deploySpokeStateFixture);

      // set hub
      const hubChainId = 1;
      const hubAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      const setHub = spokeState.connect(user).setHub(hubChainId, hubAddress);
      await expect(setHub)
        .to.be.revertedWithCustomError(spokeState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, CONFIG_CONTRACTS_ROLE);
    });

    it("Should fail to set address oracle when sender is not config admin", async () => {
      const { user, spokeState } = await loadFixture(deploySpokeStateFixture);

      // set address oracle
      const addressOracle = getRandomAddress();
      const setAddressOracle = spokeState.connect(user).setAddressOracle(addressOracle);
      await expect(setAddressOracle)
        .to.be.revertedWithCustomError(spokeState, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, CONFIG_CONTRACTS_ROLE);
    });
  });
});

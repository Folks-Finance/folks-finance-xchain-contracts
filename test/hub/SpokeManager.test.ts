import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SpokeManager__factory } from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertStringToBytes,
  getEmptyBytes,
  getRandomAddress,
} from "../utils/bytes";
import { SECONDS_IN_DAY } from "../utils/time";

describe("SpokeManager (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const MANAGER_ROLE = ethers.keccak256(convertStringToBytes("MANAGER"));

  async function deploySpokeManagerFixture() {
    const [admin, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const spokeManager = await new SpokeManager__factory(admin).deploy(admin.address);

    return { admin, unusedUsers, spokeManager };
  }

  async function activateSpokeFixture() {
    const { admin, unusedUsers, spokeManager } = await loadFixture(deploySpokeManagerFixture);

    const spokeChainId = 0;
    const spokeAddr = convertEVMAddressToGenericAddress(getRandomAddress());
    const activateSpoke = await spokeManager.activateSpoke(spokeChainId, spokeAddr);

    return { admin, unusedUsers, spokeManager, activateSpoke, spokeChainId, spokeAddr };
  }

  async function depreciateSpokeFixture() {
    const { admin, unusedUsers, spokeManager, spokeChainId, spokeAddr } = await loadFixture(activateSpokeFixture);

    const depreciateSpoke = await spokeManager.depreciateSpoke(spokeChainId, spokeAddr);

    return { admin, unusedUsers, spokeManager, depreciateSpoke, spokeChainId, spokeAddr };
  }

  describe("Deployment", () => {
    it("Should set default admin and spoke role correctly", async () => {
      const { admin, spokeManager } = await loadFixture(deploySpokeManagerFixture);

      // check default admin role
      expect(await spokeManager.owner()).to.equal(admin.address);
      expect(await spokeManager.defaultAdmin()).to.equal(admin.address);
      expect(await spokeManager.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await spokeManager.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeManager.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check manager
      expect(await spokeManager.getRoleAdmin(MANAGER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeManager.hasRole(MANAGER_ROLE, admin.address)).to.be.true;
    });
  });

  describe("Activate Spoke", () => {
    it("Should successfuly activate spoke", async () => {
      const { spokeManager, spokeChainId, spokeAddr } = await loadFixture(activateSpokeFixture);

      // verify spoke was activated
      expect(await spokeManager.isSpoke(spokeChainId, spokeAddr)).to.be.true;
    });

    it("Should fail to activate spoke when sender is not manager", async () => {
      const { unusedUsers, spokeManager } = await loadFixture(deploySpokeManagerFixture);
      const sender = unusedUsers[0];

      // activate spoke using not manager
      const spokeChainId = 0;
      const spokeAddr = convertEVMAddressToGenericAddress(getRandomAddress());
      const activateSpoke = spokeManager.connect(sender).activateSpoke(spokeChainId, spokeAddr);
      await expect(activateSpoke)
        .to.be.revertedWithCustomError(spokeManager, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, MANAGER_ROLE);
    });

    it("Should fail to activate spoke when spoke already active", async () => {
      const { spokeManager, spokeChainId, spokeAddr } = await loadFixture(activateSpokeFixture);

      // verify spoke is activated
      expect(await spokeManager.isSpoke(spokeChainId, spokeAddr)).to.be.true;

      // activate spoke
      const activateSpoke = spokeManager.activateSpoke(spokeChainId, spokeAddr);
      await expect(activateSpoke)
        .to.be.revertedWithCustomError(spokeManager, "SpokeAlreadyActive")
        .withArgs(spokeChainId, spokeAddr);
    });
  });

  describe("Depreciate Spoke", () => {
    it("Should successfuly depreciate spoke", async () => {
      const { spokeManager, spokeChainId, spokeAddr } = await loadFixture(depreciateSpokeFixture);

      // verify spoke was depreciated
      expect(await spokeManager.isSpoke(spokeChainId, spokeAddr)).to.be.false;
    });

    it("Should fail to depreciate spoke when sender is not manager", async () => {
      const { unusedUsers, spokeManager, spokeChainId, spokeAddr } = await loadFixture(depreciateSpokeFixture);
      const sender = unusedUsers[0];

      // depreciate spoke using not manager
      const depreciateSpoke = spokeManager.connect(sender).activateSpoke(spokeChainId, spokeAddr);
      await expect(depreciateSpoke)
        .to.be.revertedWithCustomError(spokeManager, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, MANAGER_ROLE);
    });

    it("Should fail to depreciate spoke when spoke not active", async () => {
      const { spokeManager } = await loadFixture(deploySpokeManagerFixture);
      const spokeChainId = 0;
      const spokeAddr = convertEVMAddressToGenericAddress(getRandomAddress());

      // verify spoke is not active
      expect(await spokeManager.isSpoke(spokeChainId, spokeAddr)).to.be.false;

      // depreciate spoke
      const depreciateSpoke = spokeManager.depreciateSpoke(spokeChainId, spokeAddr);
      await expect(depreciateSpoke)
        .to.be.revertedWithCustomError(spokeManager, "SpokeNotActive")
        .withArgs(spokeChainId, spokeAddr);
    });
  });
});

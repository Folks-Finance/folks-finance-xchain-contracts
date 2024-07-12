import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { BridgeRouterHubExposed__factory, BridgeRouterHub__factory, MockAdapter__factory } from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
} from "../utils/bytes";
import { MessagePayload } from "../utils/messages/messages";
import { SECONDS_IN_DAY } from "../utils/time";

describe("BridgeRouter (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const MANAGER_ROLE = ethers.keccak256(convertStringToBytes("MANAGER"));
  const WITHDRAWER_ROLE = ethers.keccak256(convertStringToBytes("WITHDRAWER"));

  const accountId: string = getAccountIdBytes("ACCOUNT_ID");

  async function deployBridgeRouterFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const bridgeRouter = await new BridgeRouterHub__factory(admin).deploy(admin.address);
    const bridgeRouterExposed = await new BridgeRouterHubExposed__factory(admin).deploy(admin.address);
    const bridgeRouterAddress = await bridgeRouter.getAddress();

    return { admin, user, unusedUsers, bridgeRouter, bridgeRouterExposed, bridgeRouterAddress };
  }

  async function fundUserIdFixture() {
    const { admin, user, unusedUsers, bridgeRouter, bridgeRouterAddress } =
      await loadFixture(deployBridgeRouterFixture);
    // deploy and add adapter
    const adapter = await new MockAdapter__factory(admin).deploy(bridgeRouterAddress);
    const adapterId = 0;
    const adapterAddress = await adapter.getAddress();
    await bridgeRouter.addAdapter(adapterId, adapterAddress);

    // setup balance
    const userId = accountId;
    const startingBalance = BigInt(5000000);
    await bridgeRouter.increaseBalance(userId, { value: startingBalance });
    expect(await bridgeRouter.balances(userId)).to.be.equal(startingBalance);

    return {
      admin,
      user,
      unusedUsers,
      bridgeRouter,
      bridgeRouterAddress,
      startingBalance,
      userId,
    };
  }

  describe("Deployment", () => {
    it("Should set default admin, manager and withdrawer roles correctly", async () => {
      const { admin, bridgeRouter } = await loadFixture(deployBridgeRouterFixture);

      // check default admin role
      expect(await bridgeRouter.owner()).to.equal(admin.address);
      expect(await bridgeRouter.defaultAdmin()).to.equal(admin.address);
      expect(await bridgeRouter.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await bridgeRouter.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await bridgeRouter.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check manager
      expect(await bridgeRouter.getRoleAdmin(MANAGER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await bridgeRouter.hasRole(MANAGER_ROLE, admin.address)).to.be.true;

      // check withdrawer
      expect(await bridgeRouter.getRoleAdmin(WITHDRAWER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await bridgeRouter.hasRole(WITHDRAWER_ROLE, admin.address)).to.be.true;
    });
  });

  describe("Get user id", () => {
    it("Should return account id", async () => {
      const { bridgeRouterExposed } = await loadFixture(deployBridgeRouterFixture);

      const payload: MessagePayload = {
        action: 0,
        accountId,
        userAddress: convertEVMAddressToGenericAddress(getRandomAddress()),
        data: "0x",
      };

      // get user id
      const userId = await bridgeRouterExposed.getUserId(payload);
      expect(userId).to.equal(accountId);
    });
  });

  describe("Withdraw", () => {
    it("Should successfuly withdraw when sender is withdrawer", async () => {
      const { admin, user, bridgeRouter, startingBalance, userId } = await loadFixture(fundUserIdFixture);

      // balance before
      const userBalance = await ethers.provider.getBalance(user);

      // withdraw
      const withdraw = await bridgeRouter.connect(admin).withdraw(userId, user.address);

      await expect(withdraw).to.emit(bridgeRouter, "Withdraw").withArgs(userId, user.address, startingBalance);
      expect(await bridgeRouter.balances(userId)).to.be.equal(0);
      expect(await ethers.provider.getBalance(user)).to.be.equal(userBalance + startingBalance);
    });

    it("Should fail to withdraw when sender is not withdrawer", async () => {
      const { user, bridgeRouter, userId } = await loadFixture(fundUserIdFixture);

      // withdraw
      const withdraw = bridgeRouter.connect(user).withdraw(userId, user.address);
      expect(withdraw)
        .to.be.revertedWithCustomError(bridgeRouter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, WITHDRAWER_ROLE);
    });

    // TODO test non payable recipient
  });
});

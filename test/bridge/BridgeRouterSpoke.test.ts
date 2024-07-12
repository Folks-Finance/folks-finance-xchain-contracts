import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSpokeExposed__factory,
  BridgeRouterSpoke__factory,
  MockAdapter__factory,
} from "../../typechain-types";
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

  const accountId: string = getAccountIdBytes("ACCOUNT_ID");

  async function deployBridgeRouterFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const bridgeRouter = await new BridgeRouterSpoke__factory(admin).deploy(admin.address);
    const bridgeRouterExposed = await new BridgeRouterSpokeExposed__factory(admin).deploy(admin.address);
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
    const userId = convertEVMAddressToGenericAddress(user.address);
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
    it("Should set default admin and manager roles correctly", async () => {
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
    });
  });

  describe("Get user id", () => {
    it("Should return user address", async () => {
      const { bridgeRouterExposed } = await loadFixture(deployBridgeRouterFixture);

      const userAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      const payload: MessagePayload = {
        action: 0,
        accountId,
        userAddress,
        data: "0x",
      };

      // get user id
      const userId = await bridgeRouterExposed.getUserId(payload);
      expect(userId).to.equal(userAddress);
    });
  });

  describe("Withdraw", () => {
    it("Should successfuly withdraw balance", async () => {
      const { user, bridgeRouter, startingBalance, userId } = await loadFixture(fundUserIdFixture);

      // balance before
      const userBalance = await ethers.provider.getBalance(user);

      // withdraw
      const withdraw = await bridgeRouter.connect(user).withdraw();
      const receipt = await ethers.provider.getTransactionReceipt(withdraw.hash);

      await expect(withdraw).to.emit(bridgeRouter, "Withdraw").withArgs(userId, user.address, startingBalance);
      expect(await bridgeRouter.balances(userId)).to.be.equal(0);
      expect(await ethers.provider.getBalance(user)).to.be.equal(userBalance + startingBalance - receipt!.fee);
    });

    // TODO test non payable recipient
  });
});

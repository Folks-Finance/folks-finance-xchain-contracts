import { expect } from "chai";
import { ethers } from "hardhat";
import {
  impersonateAccount,
  loadFixture,
  reset,
  setBalance,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  SimpleAddressOracle__factory,
  MockBridgeRouter__factory,
  SpokeErc20Token__factory,
  SimpleERC20Token__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  UINT256_LENGTH,
  UINT8_LENGTH,
  convertEVMAddressToGenericAddress,
  convertNumberToBytes,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
  getRandomBytes,
} from "../utils/bytes";
import { MessageParams, Finality, Action, buildMessagePayload, MessageReceived } from "../utils/messages/messages";
import { BucketConfig } from "../utils/rateLimiter";
import { SECONDS_IN_DAY, SECONDS_IN_WEEK } from "../utils/time";

describe("SpokeERC20Token contract (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const CONFIG_CONTRACTS_ROLE = ethers.keccak256(convertStringToBytes("CONFIG_CONTRACTS"));
  const CONFIG_RATE_LIMIT_ROLE = ethers.keccak256(convertStringToBytes("CONFIG_RATE_LIMIT"));
  const BOOST_RATE_LIMIT_ROLE = ethers.keccak256(convertStringToBytes("BOOST_RATE_LIMIT"));

  const STARTING_TIMESTAMP = BigInt(1897776000);

  const MESSAGE_PARAMS: MessageParams = {
    adapterId: BigInt(0),
    returnAdapterId: BigInt(0),
    receiverValue: BigInt(0),
    gasLimit: BigInt(30000),
    returnGasLimit: BigInt(0),
  };

  async function deploySpokeFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy token and fund user
    const token = await new SimpleERC20Token__factory(user).deploy("ChainLink", "LINK");
    await token.mint(user, BigInt(1000e18));

    // deploy spoke
    const bridgeRouter = await new MockBridgeRouter__factory(user).deploy();
    const hubChainId = 0;
    const hubAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    const addressOracle = await new SimpleAddressOracle__factory(user).deploy();
    const initialBucketConfig: BucketConfig = {
      period: BigInt(SECONDS_IN_DAY),
      offset: BigInt(0),
      limit: BigInt(1e18),
    };
    const poolId = 3;
    const spokeToken = await new SpokeErc20Token__factory(user).deploy(
      admin.address,
      bridgeRouter,
      hubChainId,
      hubAddress,
      addressOracle,
      initialBucketConfig,
      poolId,
      token
    );
    const spokeAddress = await spokeToken.getAddress();

    // set time to beginning of a day
    await time.increaseTo(STARTING_TIMESTAMP);

    // impersonate bridge router
    const bridgeRouterAddress = await bridgeRouter.getAddress();
    impersonateAccount(bridgeRouterAddress);
    const bridgeRouterSigner = await ethers.getSigner(bridgeRouterAddress);

    return {
      admin,
      user,
      unusedUsers,
      token,
      spokeToken,
      spokeAddress,
      bridgeRouter,
      bridgeRouterAddress,
      bridgeRouterSigner,
      hubChainId,
      hubAddress,
      addressOracle,
      initialBucketConfig,
      poolId,
    };
  }

  // clear timestamp changes
  after(async () => {
    await reset();
  });

  describe("Deployment", () => {
    it("Should set roles and state correctly", async () => {
      const {
        admin,
        token,
        spokeToken,
        bridgeRouter,
        hubChainId,
        hubAddress,
        addressOracle,
        initialBucketConfig,
        poolId,
      } = await loadFixture(deploySpokeFixture);

      // check default admin role
      expect(await spokeToken.owner()).to.equal(admin.address);
      expect(await spokeToken.defaultAdmin()).to.equal(admin.address);
      expect(await spokeToken.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await spokeToken.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeToken.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check config contracts role
      expect(await spokeToken.getRoleAdmin(CONFIG_CONTRACTS_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeToken.hasRole(CONFIG_CONTRACTS_ROLE, admin.address)).to.be.true;

      // check rate limiter roles
      expect(await spokeToken.getRoleAdmin(CONFIG_RATE_LIMIT_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeToken.hasRole(CONFIG_RATE_LIMIT_ROLE, admin.address)).to.be.true;
      expect(await spokeToken.getRoleAdmin(BOOST_RATE_LIMIT_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeToken.hasRole(BOOST_RATE_LIMIT_ROLE, admin.address)).to.be.true;

      // check state
      expect(await spokeToken.getBridgeRouter()).to.equal(bridgeRouter);
      expect(await spokeToken.getHubChainId()).to.equal(hubChainId);
      expect(await spokeToken.getHubContractAddress()).to.equal(hubAddress);
      expect(await spokeToken.getAddressOracle()).to.equal(addressOracle);
      expect(await spokeToken.bucketConfig()).to.deep.equal(Object.values(initialBucketConfig));
      expect(await spokeToken.poolId()).to.equal(poolId);
      expect(await spokeToken.token()).to.equal(token);
    });
  });

  describe("Capacity", () => {
    it("Should be overridden by min limit when greater than specified limit", async () => {
      const { admin, token, spokeToken, initialBucketConfig } = await loadFixture(deploySpokeFixture);

      // ensure period is updated and check limit
      await spokeToken.connect(admin).boostCapacity(0);
      expect(await spokeToken.currentCapacity()).to.equal(initialBucketConfig.limit);

      // set balance
      const spokeTokenAddress = await spokeToken.getAddress();
      const balance = BigInt(101e18);
      await token.mint(spokeTokenAddress, balance);

      // increase time so new period and check limit
      const newTimestamp = STARTING_TIMESTAMP + BigInt(SECONDS_IN_WEEK);
      await time.increaseTo(newTimestamp);
      await spokeToken.connect(admin).boostCapacity(0);
      expect(await spokeToken.currentCapacity()).to.equal(balance / BigInt(100));
    });
  });

  describe("Deposit", () => {
    it("Should receive token and send correct message", async () => {
      const { user, token, spokeToken, spokeAddress, bridgeRouter, hubChainId, hubAddress, poolId } =
        await loadFixture(deploySpokeFixture);

      // approve spoke to transfer token
      const amount = BigInt(1e9);
      await token.approve(spokeAddress, amount);

      // call deposit
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const feeAmount = BigInt(1e5);
      const deposit = await spokeToken.deposit(MESSAGE_PARAMS, accountId, loanId, amount, {
        value: feeAmount,
      });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.Deposit,
        accountId,
        user.address,
        ethers.concat([
          loanId,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(amount, UINT256_LENGTH),
        ])
      );

      await expect(deposit)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.FINALISED, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
      expect(await token.balanceOf(spokeAddress)).to.equal(amount);
    });
  });

  describe("Repay", () => {
    it("Should receive token and send correct message", async () => {
      const { user, token, spokeToken, spokeAddress, bridgeRouter, hubChainId, hubAddress, poolId } =
        await loadFixture(deploySpokeFixture);

      // approve spoke to transfer token
      const amount = BigInt(1e9);
      await token.approve(spokeAddress, amount);

      // call repay
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const maxOverRepayment = BigInt(1e4);
      const feeAmount = BigInt(1e5);
      const repay = await spokeToken.repay(MESSAGE_PARAMS, accountId, loanId, amount, maxOverRepayment, {
        value: feeAmount,
      });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.Repay,
        accountId,
        user.address,
        ethers.concat([
          loanId,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(amount, UINT256_LENGTH),
          convertNumberToBytes(maxOverRepayment, UINT256_LENGTH),
        ])
      );

      await expect(repay)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.FINALISED, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
      expect(await token.balanceOf(spokeAddress)).to.equal(amount);
    });
  });

  describe("Receive message", () => {
    it("Should send token to user", async () => {
      const { user, token, spokeToken, spokeAddress, bridgeRouterAddress, bridgeRouterSigner, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // fund bridge router and spoke to send transaction
      setBalance(bridgeRouterAddress, 1e18);
      await token.mint(spokeAddress, BigInt(1e18));

      // balance before
      const balance = await token.balanceOf(user.address);

      // receive message
      const messageId: string = getRandomBytes(BYTES32_LENGTH);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const amount = BigInt(1e9);
      const message: MessageReceived = {
        messageId: messageId,
        sourceChainId: BigInt(hubChainId),
        sourceAddress: convertEVMAddressToGenericAddress(hubAddress),
        handler: convertEVMAddressToGenericAddress(spokeAddress),
        payload: buildMessagePayload(
          Action.SendToken,
          accountId,
          user.address,
          convertNumberToBytes(amount, UINT256_LENGTH)
        ),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };
      await spokeToken.connect(bridgeRouterSigner).receiveMessage(message);
      expect(await token.balanceOf(user.address)).to.equal(balance + amount);
    });
  });
});

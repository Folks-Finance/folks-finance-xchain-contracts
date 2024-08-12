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
  SpokeMockToken__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  BYTES4_LENGTH,
  UINT16_LENGTH,
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
import { SECONDS_IN_DAY } from "../utils/time";

describe("SpokeToken contract (unit tests)", () => {
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
    const spokeToken = await new SpokeMockToken__factory(user).deploy(
      admin.address,
      bridgeRouter,
      hubChainId,
      hubAddress,
      addressOracle,
      initialBucketConfig,
      poolId
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
      const { admin, spokeToken, bridgeRouter, hubChainId, hubAddress, addressOracle, initialBucketConfig, poolId } =
        await loadFixture(deploySpokeFixture);

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
    });
  });

  describe("Create Loan and Deposit", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeToken, spokeAddress, bridgeRouter, hubChainId, hubAddress, initialBucketConfig, poolId } =
        await loadFixture(deploySpokeFixture);

      // call create loan and deposit
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const nonce: string = getRandomBytes(BYTES4_LENGTH);
      const amount = BigInt(1e9);
      const loanTypeId = 2;
      const loanName = getRandomBytes(BYTES32_LENGTH);
      const createLoanAndDeposit = await spokeToken.createLoanAndDeposit(
        MESSAGE_PARAMS,
        accountId,
        nonce,
        amount,
        loanTypeId,
        loanName
      );

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.CreateLoanAndDeposit,
        accountId,
        user.address,
        ethers.concat([
          nonce,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(amount, UINT256_LENGTH),
          convertNumberToBytes(loanTypeId, UINT16_LENGTH),
          loanName,
        ])
      );
      await expect(createLoanAndDeposit)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.FINALISED, "0x");

      // capacity increase
      const periodNumber = await spokeToken.currentPeriodNumber();
      await expect(createLoanAndDeposit)
        .to.emit(spokeToken, "CapacityIncreased")
        .withArgs(periodNumber, amount, initialBucketConfig.limit + amount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeToken, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call create loan and deposit
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const nonce: string = getRandomBytes(BYTES4_LENGTH);
      const amount = BigInt(1e9);
      const loanTypeId = 2;
      const loanName = getRandomBytes(BYTES32_LENGTH);
      const createLoanAndDeposit = spokeToken.createLoanAndDeposit(
        MESSAGE_PARAMS,
        accountId,
        nonce,
        amount,
        loanTypeId,
        loanName
      );
      await expect(createLoanAndDeposit)
        .to.be.revertedWithCustomError(spokeToken, "AddressIneligible")
        .withArgs(user.address, Action.CreateLoanAndDeposit);
    });
  });

  describe("Deposit", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeToken, spokeAddress, bridgeRouter, hubChainId, hubAddress, initialBucketConfig, poolId } =
        await loadFixture(deploySpokeFixture);

      // call deposit
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const amount = BigInt(1e9);
      const deposit = await spokeToken.deposit(MESSAGE_PARAMS, accountId, loanId, amount);

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

      // capacity increase
      const periodNumber = await spokeToken.currentPeriodNumber();
      await expect(deposit)
        .to.emit(spokeToken, "CapacityIncreased")
        .withArgs(periodNumber, amount, initialBucketConfig.limit + amount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeToken, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call deposit
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const amount = BigInt(1e9);
      const deposit = spokeToken.deposit(MESSAGE_PARAMS, accountId, loanId, amount);
      await expect(deposit)
        .to.be.revertedWithCustomError(spokeToken, "AddressIneligible")
        .withArgs(user.address, Action.Deposit);
    });
  });

  describe("Repay", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeToken, spokeAddress, bridgeRouter, hubChainId, hubAddress, initialBucketConfig, poolId } =
        await loadFixture(deploySpokeFixture);

      // call repay
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const amount = BigInt(1e9);
      const maxOverRepayment = BigInt(1e4);
      const repay = await spokeToken.repay(MESSAGE_PARAMS, accountId, loanId, amount, maxOverRepayment);

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

      // capacity increase
      const periodNumber = await spokeToken.currentPeriodNumber();
      await expect(repay)
        .to.emit(spokeToken, "CapacityIncreased")
        .withArgs(periodNumber, amount, initialBucketConfig.limit + amount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeToken, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call repay
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const amount = BigInt(1e9);
      const maxOverRepayment = BigInt(1e4);
      const repay = spokeToken.repay(MESSAGE_PARAMS, accountId, loanId, amount, maxOverRepayment);
      await expect(repay)
        .to.be.revertedWithCustomError(spokeToken, "AddressIneligible")
        .withArgs(user.address, Action.Repay);
    });
  });

  describe("Receive Message", () => {
    it("Should successfully receive send token message", async () => {
      const {
        user,
        spokeToken,
        spokeAddress,
        bridgeRouterAddress,
        bridgeRouterSigner,
        hubChainId,
        hubAddress,
        initialBucketConfig,
      } = await loadFixture(deploySpokeFixture);

      // fund bridge router to send transaction
      setBalance(bridgeRouterAddress, 1e18);

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
      const receiveMessage = await spokeToken.connect(bridgeRouterSigner).receiveMessage(message);
      await expect(receiveMessage).to.emit(spokeToken, "SendToken").withArgs(user.address, amount);

      // capacity decrease
      const periodNumber = await spokeToken.currentPeriodNumber();
      await expect(receiveMessage)
        .to.emit(spokeToken, "CapacityDecreased")
        .withArgs(periodNumber, amount, initialBucketConfig.limit - amount);
    });

    it("Should fail to receive message when hub is unknown", async () => {
      const { user, spokeToken, spokeAddress, bridgeRouterAddress, bridgeRouterSigner, hubChainId } =
        await loadFixture(deploySpokeFixture);

      // fund bridge router to send transaction
      setBalance(bridgeRouterAddress, 1e18);

      // receive message
      const messageId: string = getRandomBytes(BYTES32_LENGTH);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const hubAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      const amount = BigInt(1e9);
      const message: MessageReceived = {
        messageId: messageId,
        sourceChainId: BigInt(hubChainId),
        sourceAddress: hubAddress,
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
      const receiveMessage = spokeToken.connect(bridgeRouterSigner).receiveMessage(message);
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(spokeToken, "HubUnknown")
        .withArgs(hubChainId, hubAddress);
    });

    it("Should fail to receive message when action is unsupported", async () => {
      const { user, spokeToken, spokeAddress, bridgeRouterAddress, bridgeRouterSigner, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // fund bridge router to send transaction
      setBalance(bridgeRouterAddress, 1e18);

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
          Action.Borrow,
          accountId,
          user.address,
          convertNumberToBytes(amount, UINT256_LENGTH)
        ),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };
      const receiveMessage = spokeToken.connect(bridgeRouterSigner).receiveMessage(message);
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(spokeToken, "CannotReceiveMessage")
        .withArgs(message.messageId);
    });
  });

  it("Should fail to reverse message", async () => {
    const { spokeToken, spokeAddress, bridgeRouterAddress, bridgeRouterSigner } = await loadFixture(deploySpokeFixture);

    // fund bridge router to send transaction
    setBalance(bridgeRouterAddress, 1e18);

    // reverse message
    const messageId: string = getRandomBytes(BYTES32_LENGTH);
    const accountId: string = getAccountIdBytes("ACCOUNT_ID");
    const message: MessageReceived = {
      messageId: messageId,
      sourceChainId: BigInt(0),
      sourceAddress: convertEVMAddressToGenericAddress(getRandomAddress()),
      handler: convertEVMAddressToGenericAddress(spokeAddress),
      payload: buildMessagePayload(0, accountId, getRandomAddress(), "0x"),
      returnAdapterId: BigInt(0),
      returnGasLimit: BigInt(0),
    };
    const extraArgs = "0x";
    const receiveMessage = spokeToken.connect(bridgeRouterSigner).reverseMessage(message, extraArgs);
    await expect(receiveMessage).to.be.revertedWithCustomError(spokeToken, "CannotReverseMessage").withArgs(messageId);
  });
});

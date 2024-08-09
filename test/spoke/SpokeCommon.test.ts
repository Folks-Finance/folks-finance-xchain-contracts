import { expect } from "chai";
import { ethers } from "hardhat";
import { impersonateAccount, loadFixture, setBalance } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { MockBridgeRouter__factory, SimpleAddressOracle__factory, SpokeCommon__factory } from "../../typechain-types";
import {
  BYTES32_LENGTH,
  BYTES4_LENGTH,
  UINT16_LENGTH,
  UINT256_LENGTH,
  UINT8_LENGTH,
  convertBooleanToByte,
  convertEVMAddressToGenericAddress,
  convertNumberToBytes,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
  getRandomBytes,
} from "../utils/bytes";
import { MessageParams, Finality, Action, buildMessagePayload, MessageReceived } from "../utils/messages/messages";
import { SECONDS_IN_DAY } from "../utils/time";

describe("SpokeCommon contract (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const CONFIG_CONTRACTS_ROLE = ethers.keccak256(convertStringToBytes("CONFIG_CONTRACTS"));

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
    const spokeCommon = await new SpokeCommon__factory(user).deploy(
      admin.address,
      bridgeRouter,
      hubChainId,
      hubAddress,
      addressOracle
    );
    const spokeAddress = await spokeCommon.getAddress();

    // impersonate bridge router
    const bridgeRouterAddress = await bridgeRouter.getAddress();
    impersonateAccount(bridgeRouterAddress);
    const bridgeRouterSigner = await ethers.getSigner(bridgeRouterAddress);

    return {
      admin,
      user,
      unusedUsers,
      spokeCommon,
      spokeAddress,
      bridgeRouter,
      bridgeRouterAddress,
      bridgeRouterSigner,
      hubChainId,
      hubAddress,
      addressOracle,
    };
  }

  describe("Deployment", () => {
    it("Should set admin, bridge router and contracts correctly", async () => {
      const { admin, spokeCommon, bridgeRouter, hubChainId, hubAddress, addressOracle } =
        await loadFixture(deploySpokeFixture);

      // check default admin role
      expect(await spokeCommon.owner()).to.equal(admin.address);
      expect(await spokeCommon.defaultAdmin()).to.equal(admin.address);
      expect(await spokeCommon.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await spokeCommon.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeCommon.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check config contracts role
      expect(await spokeCommon.getRoleAdmin(CONFIG_CONTRACTS_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await spokeCommon.hasRole(CONFIG_CONTRACTS_ROLE, admin.address)).to.be.true;

      // check state
      expect(await spokeCommon.getBridgeRouter()).to.equal(bridgeRouter);
      expect(await spokeCommon.getHubChainId()).to.equal(hubChainId);
      expect(await spokeCommon.getHubContractAddress()).to.equal(hubAddress);
      expect(await spokeCommon.getAddressOracle()).to.equal(addressOracle);
    });
  });

  describe("Create Account", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call create account
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const nonce: string = getRandomBytes(BYTES4_LENGTH);
      const refAccountId: string = getAccountIdBytes("REFERRER");
      const feeAmount = BigInt(30000);
      const createAccount = spokeCommon.createAccount(MESSAGE_PARAMS, accountId, nonce, refAccountId, {
        value: feeAmount,
      });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.CreateAccount,
        accountId,
        user.address,
        ethers.concat([nonce, refAccountId])
      );
      await expect(createAccount)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // create account
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const nonce: string = getRandomBytes(BYTES4_LENGTH);
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);
      const createAccount = spokeCommon.createAccount(MESSAGE_PARAMS, accountId, nonce, refAccountId);
      await expect(createAccount)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.CreateAccount);
    });
  });

  describe("Invite Address", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, unusedUsers, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call invite address
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const inviteeChainId = 3;
      const inviteeAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const refAccountId: string = getAccountIdBytes("REFERRER");
      const feeAmount = BigInt(30000);
      const inviteAddress = spokeCommon.inviteAddress(
        MESSAGE_PARAMS,
        accountId,
        inviteeChainId,
        inviteeAddr,
        refAccountId,
        {
          value: feeAmount,
        }
      );

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.InviteAddress,
        accountId,
        user.address,
        ethers.concat([convertNumberToBytes(inviteeChainId, UINT16_LENGTH), inviteeAddr, refAccountId])
      );
      await expect(inviteAddress)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, unusedUsers, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call invite address
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const inviteeChainId = 3;
      const inviteeAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);
      const inviteAddress = spokeCommon.inviteAddress(
        MESSAGE_PARAMS,
        accountId,
        inviteeChainId,
        inviteeAddr,
        refAccountId
      );
      await expect(inviteAddress)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.InviteAddress);
    });
  });

  describe("Accept invite", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call accept invite
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const feeAmount = BigInt(30000);
      const acceptInvite = spokeCommon.acceptInviteAddress(MESSAGE_PARAMS, accountId, { value: feeAmount });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(Action.AcceptInviteAddress, accountId, user.address, "0x");
      await expect(acceptInvite)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call accept invite
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const acceptInvite = spokeCommon.acceptInviteAddress(MESSAGE_PARAMS, accountId);
      await expect(acceptInvite)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.AcceptInviteAddress);
    });
  });

  describe("Unregister address", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call unregister address
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const unregisterChainId = 3;
      const feeAmount = BigInt(30000);
      const unregisterAddress = spokeCommon.unregisterAddress(MESSAGE_PARAMS, accountId, unregisterChainId, {
        value: feeAmount,
      });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.UnregisterAddress,
        accountId,
        user.address,
        convertNumberToBytes(unregisterChainId, UINT16_LENGTH)
      );
      await expect(unregisterAddress)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call unregister address
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const unregisterChainId = 3;
      const unregisterAddress = spokeCommon.unregisterAddress(MESSAGE_PARAMS, accountId, unregisterChainId);
      await expect(unregisterAddress)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.UnregisterAddress);
    });
  });

  describe("Add delegate", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, unusedUsers, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call add delegate
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const delegateAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const feeAmount = BigInt(30000);
      const addDelegate = spokeCommon.addDelegate(MESSAGE_PARAMS, accountId, delegateAddr, { value: feeAmount });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(Action.AddDelegate, accountId, user.address, delegateAddr);
      await expect(addDelegate)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, unusedUsers, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call add delegate
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const delegateAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const addDelegate = spokeCommon.addDelegate(MESSAGE_PARAMS, accountId, delegateAddr);
      await expect(addDelegate)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.AddDelegate);
    });
  });

  describe("Remove delegate", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, unusedUsers, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call remove delegate
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const delegateAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const feeAmount = BigInt(30000);
      const removeDelegate = spokeCommon.removeDelegate(MESSAGE_PARAMS, accountId, delegateAddr, { value: feeAmount });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(Action.RemoveDelegate, accountId, user.address, delegateAddr);
      await expect(removeDelegate)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, unusedUsers, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call remove delegate
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const delegateAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const removeDelegate = spokeCommon.removeDelegate(MESSAGE_PARAMS, accountId, delegateAddr);
      await expect(removeDelegate)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.RemoveDelegate);
    });
  });

  describe("Create loan", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call create loan
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const nonce: string = getRandomBytes(BYTES4_LENGTH);
      const loanTypeId = 2;
      const loanName = getRandomBytes(BYTES32_LENGTH);
      const feeAmount = BigInt(30000);
      const createLoan = spokeCommon.createLoan(MESSAGE_PARAMS, accountId, nonce, loanTypeId, loanName, {
        value: feeAmount,
      });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.CreateLoan,
        accountId,
        user.address,
        ethers.concat([nonce, convertNumberToBytes(loanTypeId, UINT16_LENGTH), loanName])
      );
      await expect(createLoan)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call create loan
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const nonce: string = getRandomBytes(BYTES4_LENGTH);
      const loanTypeId = 2;
      const loanName = getRandomBytes(BYTES32_LENGTH);
      const createLoan = spokeCommon.createLoan(MESSAGE_PARAMS, accountId, nonce, loanTypeId, loanName);
      await expect(createLoan)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.CreateLoan);
    });
  });

  describe("Delete loan", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call delete loan
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const feeAmount = BigInt(30000);
      const deleteLoan = spokeCommon.deleteLoan(MESSAGE_PARAMS, accountId, loanId, { value: feeAmount });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(Action.DeleteLoan, accountId, user.address, loanId);
      await expect(deleteLoan)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call delete loan
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const deleteLoan = spokeCommon.deleteLoan(MESSAGE_PARAMS, accountId, loanId);
      await expect(deleteLoan)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.DeleteLoan);
    });
  });

  describe("Withdraw", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call withdraw
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const poolId = 7;
      const chainId = 3;
      const amount = 5000;
      const isFTokenAmount = false;
      const feeAmount = BigInt(30000);
      const withdraw = spokeCommon.withdraw(
        MESSAGE_PARAMS,
        accountId,
        loanId,
        poolId,
        chainId,
        amount,
        isFTokenAmount,
        { value: feeAmount }
      );

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.Withdraw,
        accountId,
        user.address,
        ethers.concat([
          loanId,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(chainId, UINT16_LENGTH),
          convertNumberToBytes(amount, UINT256_LENGTH),
          convertBooleanToByte(isFTokenAmount),
        ])
      );
      await expect(withdraw)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call withdraw
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const poolId = 7;
      const chainId = 3;
      const amount = 5000;
      const isFTokenAmount = false;
      const withdraw = spokeCommon.withdraw(MESSAGE_PARAMS, accountId, loanId, poolId, chainId, amount, isFTokenAmount);
      await expect(withdraw)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.Withdraw);
    });
  });

  describe("Borrow", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call borrow
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const poolId = 7;
      const chainId = 3;
      const amount = 5000;
      const maxStableRate = 0;
      const feeAmount = BigInt(30000);
      const borrow = spokeCommon.borrow(MESSAGE_PARAMS, accountId, loanId, poolId, chainId, amount, maxStableRate, {
        value: feeAmount,
      });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.Borrow,
        accountId,
        user.address,
        ethers.concat([
          loanId,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(chainId, UINT16_LENGTH),
          convertNumberToBytes(amount, UINT256_LENGTH),
          convertNumberToBytes(maxStableRate, UINT256_LENGTH),
        ])
      );

      await expect(borrow)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call borrow
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const poolId = 7;
      const chainId = 3;
      const amount = 5000;
      const maxStableRate = 0;
      const borrow = spokeCommon.borrow(MESSAGE_PARAMS, accountId, loanId, poolId, chainId, amount, maxStableRate);
      await expect(borrow)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.Borrow);
    });
  });

  describe("Repay With Collateral", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call repay with collateral
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const poolId = 7;
      const amount = 5000;
      const feeAmount = BigInt(30000);
      const repayWithCollateral = spokeCommon.repayWithCollateral(MESSAGE_PARAMS, accountId, loanId, poolId, amount, {
        value: feeAmount,
      });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.RepayWithCollateral,
        accountId,
        user.address,
        ethers.concat([
          loanId,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(amount, UINT256_LENGTH),
        ])
      );

      await expect(repayWithCollateral)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call repay with collateral
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const poolId = 7;
      const amount = 5000;
      const repayWithCollateral = spokeCommon.repayWithCollateral(MESSAGE_PARAMS, accountId, loanId, poolId, amount);
      await expect(repayWithCollateral)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.RepayWithCollateral);
    });
  });

  describe("Switch Borrow Type", () => {
    it("Should call bridge router with the correct message to send", async () => {
      const { user, spokeCommon, spokeAddress, bridgeRouter, hubChainId, hubAddress } =
        await loadFixture(deploySpokeFixture);

      // call switch borrow type
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const poolId = 7;
      const maxStableRate = 0;
      const feeAmount = BigInt(30000);
      const switchBorrowType = spokeCommon.switchBorrowType(MESSAGE_PARAMS, accountId, loanId, poolId, maxStableRate, {
        value: feeAmount,
      });

      // expect message
      const params = Object.values(MESSAGE_PARAMS);
      const sourceAddress = convertEVMAddressToGenericAddress(spokeAddress);
      const payload = buildMessagePayload(
        Action.SwitchBorrowType,
        accountId,
        user.address,
        ethers.concat([
          loanId,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(maxStableRate, UINT256_LENGTH),
        ])
      );

      await expect(switchBorrowType)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(params, sourceAddress, hubChainId, hubAddress, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(feeAmount);
    });

    it("Should fail if address is not eligible to perform action", async () => {
      const { user, spokeCommon, addressOracle } = await loadFixture(deploySpokeFixture);

      // set eligibilty to false
      await addressOracle.setEligible(false);

      // call switch borrow type
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const loanId = getRandomBytes(BYTES32_LENGTH);
      const poolId = 7;
      const maxStableRate = 0;
      const switchBorrowType = spokeCommon.switchBorrowType(MESSAGE_PARAMS, accountId, loanId, poolId, maxStableRate);
      await expect(switchBorrowType)
        .to.be.revertedWithCustomError(spokeCommon, "AddressIneligible")
        .withArgs(user.address, Action.SwitchBorrowType);
    });
  });

  it("Should fail to receive message", async () => {
    const { spokeCommon, spokeAddress, bridgeRouterAddress, bridgeRouterSigner } =
      await loadFixture(deploySpokeFixture);

    // fund bridge router to send transaction
    setBalance(bridgeRouterAddress, 1e18);

    // receive message
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
    const receiveMessage = spokeCommon.connect(bridgeRouterSigner).receiveMessage(message);
    await expect(receiveMessage).to.be.revertedWithCustomError(spokeCommon, "CannotReceiveMessage").withArgs(messageId);
  });

  it("Should fail to reverse message", async () => {
    const { spokeCommon, spokeAddress, bridgeRouterAddress, bridgeRouterSigner } =
      await loadFixture(deploySpokeFixture);

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
    const receiveMessage = spokeCommon.connect(bridgeRouterSigner).reverseMessage(message, extraArgs);
    await expect(receiveMessage).to.be.revertedWithCustomError(spokeCommon, "CannotReverseMessage").withArgs(messageId);
  });
});

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterReceiver__factory,
  Hub__factory,
  MockAccountManager__factory,
  MockHubPool,
  MockHubPool__factory,
  MockLoanManager__factory,
  MockSpokeManager__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  BYTES4_LENGTH,
  UINT16_LENGTH,
  UINT256_LENGTH,
  UINT8_LENGTH,
  convertBooleanToByte,
  convertEVMAddressToGenericAddress,
  convertGenericAddressToEVMAddress,
  convertNumberToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
  getRandomBytes,
} from "../utils/bytes";
import {
  Action,
  Finality,
  MessageParams,
  MessageReceived,
  MessageToSend,
  buildMessagePayload,
} from "../utils/messages/messages";

describe("Hub (unit tests)", () => {
  async function deployHubFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy hub contracts
    const bridgeRouter = await new BridgeRouterReceiver__factory(user).deploy();
    const spokeManager = await new MockSpokeManager__factory(user).deploy();
    const accountManager = await new MockAccountManager__factory(user).deploy();
    const loanManager = await new MockLoanManager__factory(user).deploy();
    const hubChainId = 0;
    const hub = await new Hub__factory(user).deploy(
      bridgeRouter,
      spokeManager,
      accountManager,
      loanManager,
      hubChainId
    );
    const poolId = 1;
    const pool = await new MockHubPool__factory(user).deploy("Folks USD Coin", "fUSDC", poolId);

    // common params
    const spokeChainId = 1;
    const spokeAddress = getRandomAddress();
    const spokeAdapterAddress = getRandomAddress();
    const hubAddress = await hub.getAddress();

    // set pool in loan manager
    await loanManager.setPool(poolId, pool);

    return {
      admin,
      user,
      unusedUsers,
      hub,
      hubAddress,
      pool,
      poolId,
      bridgeRouter,
      spokeManager,
      accountManager,
      loanManager,
      hubChainId,
      spokeChainId,
      spokeAddress,
      spokeAdapterAddress,
    };
  }

  const setSendTokenMessage = async (
    pool: MockHubPool,
    returnAdapterId: bigint,
    returnGasLimit: bigint,
    hubAddress: string,
    spokeChainId: number,
    spokeAddress: string,
    recipientAddress: string,
    amount: number | bigint,
    extraArgs: string
  ): Promise<MessageToSend> => {
    const params: MessageParams = {
      adapterId: returnAdapterId,
      returnAdapterId: BigInt(0),
      receiverValue: BigInt(0),
      gasLimit: returnGasLimit,
      returnGasLimit: BigInt(0),
    };
    const accountId = getEmptyBytes(BYTES32_LENGTH);
    const message: MessageToSend = {
      params: params,
      sender: convertEVMAddressToGenericAddress(hubAddress),
      destinationChainId: BigInt(spokeChainId),
      handler: convertEVMAddressToGenericAddress(spokeAddress),
      payload: buildMessagePayload(
        Action.SendToken,
        accountId,
        recipientAddress,
        convertNumberToBytes(amount, UINT256_LENGTH)
      ),
      finalityLevel: Finality.FINALISED,
      extraArgs,
    };
    await pool.setSendTokenMessage(message);

    return message;
  };

  describe("Deployment", () => {
    it("Should set hub and bridge router correctly", async () => {
      const { hub, spokeManager, accountManager, loanManager, hubChainId } = await loadFixture(deployHubFixture);
      expect(await hub.spokeManager()).to.equal(await spokeManager.getAddress());
      expect(await hub.accountManager()).to.equal(await accountManager.getAddress());
      expect(await hub.loanManager()).to.equal(await loanManager.getAddress());
      expect(await hub.hubChainId()).to.equal(hubChainId);
    });
  });

  describe("Claim Token Fees", () => {
    it("Should fail when sender is not token fee claimer", async () => {
      const { user, hub, pool, poolId } = await loadFixture(deployHubFixture);

      // verify sender is not token fee claimer
      const tokenFeeClaimer = await pool.getTokenFeeClaimer();
      expect(tokenFeeClaimer).not.to.equal(user.address);

      // claim token fees
      const chainId = 0;
      const returnAdapterId = 0;
      const returnGasLimit = 0;
      const claimTokenFees = hub.connect(user).claimTokenFees(poolId, chainId, returnAdapterId, returnGasLimit);
      await expect(claimTokenFees)
        .to.be.revertedWithCustomError(hub, "InvalidTokenFeeClaimer")
        .withArgs(tokenFeeClaimer, user.address);
    });

    it("Should successfully call send token to user for fee recipient", async () => {
      const { user, hub, hubAddress, pool, poolId, bridgeRouter, spokeChainId, spokeAddress } =
        await loadFixture(deployHubFixture);

      // verify sender is token fee claimer
      await pool.setTokenFeeClaimer(user.address);
      const tokenFeeClaimer = await pool.getTokenFeeClaimer();
      expect(tokenFeeClaimer).to.equal(user.address);

      // set token fee recipient
      const tokenFeeRecipientAddr = convertEVMAddressToGenericAddress(getRandomAddress());
      await pool.setTokenFeeRecipient(tokenFeeRecipientAddr);

      // set token fee amount
      const tokenFeeAmount = BigInt(1e18);
      await pool.setTokenFeeAmount(tokenFeeAmount);

      // set send token message
      const returnAdapterId = BigInt(1);
      const returnGasLimit = BigInt(300000);
      const sendTokenMessage = await setSendTokenMessage(
        pool,
        returnAdapterId,
        returnGasLimit,
        hubAddress,
        spokeChainId,
        spokeAddress,
        convertGenericAddressToEVMAddress(tokenFeeRecipientAddr),
        tokenFeeAmount,
        "0x"
      );

      // claim token fees
      const claimTokenFees = await hub
        .connect(user)
        .claimTokenFees(poolId, spokeChainId, returnAdapterId, returnGasLimit);

      // check fees cleared
      await expect(claimTokenFees).to.emit(pool, "ClearTokenFees").withArgs(tokenFeeAmount);

      // check pool called to get send token message
      await expect(claimTokenFees)
        .to.emit(pool, "SendTokenMessage")
        .withArgs(
          bridgeRouter,
          returnAdapterId,
          returnGasLimit,
          getEmptyBytes(BYTES32_LENGTH),
          spokeChainId,
          tokenFeeAmount,
          tokenFeeRecipientAddr
        );

      // check message sent
      await expect(claimTokenFees)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(
          Object.values(sendTokenMessage.params),
          sendTokenMessage.sender,
          sendTokenMessage.destinationChainId,
          sendTokenMessage.handler,
          sendTokenMessage.payload,
          sendTokenMessage.finalityLevel,
          sendTokenMessage.extraArgs
        );
    });
  });

  describe("Direct Operation", () => {
    it("Should not revert when sender is registered to account", async () => {
      const { user, hub, hubChainId, accountManager } = await loadFixture(deployHubFixture);

      // verify registered but not delegate
      await accountManager.setIsAddressRegisteredToAccount(true);
      await accountManager.setIsDelegate(false);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const userAddr: string = convertEVMAddressToGenericAddress(user.address);
      expect(await accountManager.isAddressRegisteredToAccount(accountId, hubChainId, userAddr)).to.be.true;
      expect(await accountManager.isDelegate(accountId, user.address)).to.be.false;

      // direct operation
      const data = getRandomBytes(BYTES32_LENGTH + 1 + UINT256_LENGTH);
      const directOperation = hub.directOperation(Action.DepositFToken, accountId, data);
      await expect(directOperation).to.not.be.reverted;
    });

    it("Should not revert when sender is delegate to account", async () => {
      const { user, hub, hubChainId, accountManager } = await loadFixture(deployHubFixture);

      // verify delegate but not registered
      await accountManager.setIsAddressRegisteredToAccount(false);
      await accountManager.setIsDelegate(true);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const userAddr: string = convertEVMAddressToGenericAddress(user.address);
      expect(await accountManager.isAddressRegisteredToAccount(accountId, hubChainId, userAddr)).to.be.false;
      expect(await accountManager.isDelegate(accountId, user.address)).to.be.true;

      // direct operation
      const data = getRandomBytes(BYTES32_LENGTH + 1 + UINT256_LENGTH);
      const directOperation = hub.directOperation(Action.DepositFToken, accountId, data);
      await expect(directOperation).to.not.be.reverted;
    });

    it("Should fail when sender is neither registered or delegate to account", async () => {
      const { user, hub, hubChainId, accountManager } = await loadFixture(deployHubFixture);

      // verify neither registered or delegate
      await accountManager.setIsAddressRegisteredToAccount(false);
      await accountManager.setIsDelegate(false);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const userAddr: string = convertEVMAddressToGenericAddress(user.address);
      expect(await accountManager.isAddressRegisteredToAccount(accountId, hubChainId, userAddr)).to.be.false;
      expect(await accountManager.isDelegate(accountId, user.address)).to.be.false;

      // direct operation
      const data = getRandomBytes(BYTES32_LENGTH + 1 + UINT256_LENGTH);
      const directOperation = hub.directOperation(Action.SendToken, accountId, data);
      await expect(directOperation)
        .to.be.revertedWithCustomError(hub, "NoPermissionOnHub")
        .withArgs(accountId, user.address);
    });

    it("Should fail when unknown payload action", async () => {
      const { hub } = await loadFixture(deployHubFixture);

      // direct operation
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const directOperation = hub.directOperation(Action.SendToken, accountId, "0x");
      await expect(directOperation)
        .to.be.revertedWithCustomError(hub, "UnsupportedDirectOperation")
        .withArgs(Action.SendToken);
    });

    describe("Deposit F Token", () => {
      it("Should successfully call deposit f token", async () => {
        const { user, hub, poolId, loanManager } = await loadFixture(deployHubFixture);

        // direct operation
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId = getRandomBytes(BYTES32_LENGTH);
        const fAmount = BigInt(1e18);
        const data = ethers.concat([
          loanId,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(fAmount, UINT256_LENGTH),
        ]);
        const directOperation = hub.directOperation(Action.DepositFToken, accountId, data);

        // verify deposit f token is called
        await expect(directOperation)
          .to.emit(loanManager, "DepositFToken")
          .withArgs(loanId, accountId, poolId, user.address, fAmount);
      });
    });

    describe("Withdraw F Token", () => {
      it("Should successfully call withdraw f token", async () => {
        const { user, hub, poolId, loanManager } = await loadFixture(deployHubFixture);

        // direct operation
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId = getRandomBytes(BYTES32_LENGTH);
        const fAmount = BigInt(1e18);
        const data = ethers.concat([
          loanId,
          convertNumberToBytes(poolId, UINT8_LENGTH),
          convertNumberToBytes(fAmount, UINT256_LENGTH),
        ]);
        const directOperation = hub.directOperation(Action.WithdrawFToken, accountId, data);

        // verify withdraw f token is called
        await expect(directOperation)
          .to.emit(loanManager, "WithdrawFToken")
          .withArgs(loanId, accountId, poolId, user.address, fAmount);
      });
    });

    describe("Liquidate", () => {
      it("Should successfully call liquidate", async () => {
        const { hub, loanManager } = await loadFixture(deployHubFixture);

        // direct operation
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const violatorLoanId = getRandomBytes(BYTES32_LENGTH);
        const liquidatorLoanId = getRandomBytes(BYTES32_LENGTH);
        const colPoolId = 0;
        const borPoolId = 1;
        const repayingAmount = BigInt(1e18);
        const minSeizedAmount = BigInt(2e18);
        const data = ethers.concat([
          violatorLoanId,
          liquidatorLoanId,
          convertNumberToBytes(colPoolId, UINT8_LENGTH),
          convertNumberToBytes(borPoolId, UINT8_LENGTH),
          convertNumberToBytes(repayingAmount, UINT256_LENGTH),
          convertNumberToBytes(minSeizedAmount, UINT256_LENGTH),
        ]);
        const directOperation = hub.directOperation(Action.Liquidate, accountId, data);

        // verify liquidate is called
        await expect(directOperation)
          .to.emit(loanManager, "Liquidate")
          .withArgs(violatorLoanId, liquidatorLoanId, accountId, colPoolId, borPoolId, repayingAmount, minSeizedAmount);
      });
    });
  });

  describe("Receive Message", () => {
    it("Should fail when spoke is unknown", async () => {
      const { user, hub, bridgeRouter, spokeManager, spokeChainId, hubAddress } = await loadFixture(deployHubFixture);

      // verify unknown spoke
      await spokeManager.setIsKnown(false);
      const sourceAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      expect(await spokeManager.isSpoke(spokeChainId, sourceAddress)).to.be.false;

      // call receive message
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const message: MessageReceived = {
        messageId,
        sourceChainId: BigInt(spokeChainId),
        sourceAddress,
        handler: convertEVMAddressToGenericAddress(hubAddress),
        payload: buildMessagePayload(0, accountId, user.address, "0x"),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };
      const receiveMessage = bridgeRouter.receiveMessage(message);

      // check failure
      const errorReason = hub.interface.encodeErrorResult("SpokeUnknown", [spokeChainId, sourceAddress]);
      await expect(receiveMessage).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
    });

    it("Should fail when unknown payload action", async () => {
      const { user, hub, bridgeRouter, spokeChainId, spokeAddress, hubAddress } = await loadFixture(deployHubFixture);

      // call receive message
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const payload = buildMessagePayload(Action.SendToken, accountId, user.address, "0x");
      const message: MessageReceived = {
        messageId,
        sourceChainId: BigInt(spokeChainId),
        sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
        handler: convertEVMAddressToGenericAddress(hubAddress),
        payload,
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };
      const receiveMessage = bridgeRouter.receiveMessage(message);

      // check failure
      const errorReason = hub.interface.encodeErrorResult("CannotReceiveMessage", [messageId]);
      await expect(receiveMessage).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
    });

    describe("Create Account", () => {
      it("Should successfully call create account", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call create account
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const nonce: string = getRandomBytes(BYTES4_LENGTH);
        const refAccountId: string = getAccountIdBytes("REFERRER");
        const payload = buildMessagePayload(
          Action.CreateAccount,
          accountId,
          user.address,
          ethers.concat([nonce, refAccountId])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const createAccount = await bridgeRouter.receiveMessage(message);

        // verify create account is called
        const userAddr = convertEVMAddressToGenericAddress(user.address);
        await expect(createAccount)
          .to.emit(accountManager, "CreateAccount(bytes32,uint16,bytes32,bytes4,bytes32)")
          .withArgs(accountId, spokeChainId, userAddr, nonce, refAccountId);
        await expect(createAccount).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });
    });

    describe("Invite Address", () => {
      it("Should successfully call invite address", async () => {
        const { user, unusedUsers, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call invite address
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const inviteeChainId: string = convertNumberToBytes(spokeChainId, UINT16_LENGTH);
        const inviteeAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
        const refAccountId: string = getAccountIdBytes("REFERRER");
        const payload = buildMessagePayload(
          Action.InviteAddress,
          accountId,
          user.address,
          ethers.concat([inviteeChainId, inviteeAddr, refAccountId])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const inviteAddress = await bridgeRouter.receiveMessage(message);

        // verify invite address is called
        await expect(inviteAddress)
          .to.emit(accountManager, "InviteAddress")
          .withArgs(accountId, inviteeChainId, inviteeAddr, refAccountId);
        await expect(inviteAddress).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, unusedUsers, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call invite address
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const inviteeChainId: string = convertNumberToBytes(spokeChainId, UINT16_LENGTH);
        const inviteeAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
        const payload = buildMessagePayload(
          Action.InviteAddress,
          accountId,
          user.address,
          ethers.concat([inviteeChainId, inviteeAddr])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const inviteAddress = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(inviteAddress).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Accept invite", () => {
      it("Should successfully call accept invite", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call accept invite
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const payload = buildMessagePayload(Action.AcceptInviteAddress, accountId, user.address, "0x");
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const acceptInviteAddress = await bridgeRouter.receiveMessage(message);

        // verify accept invite is called
        const userAddr = convertEVMAddressToGenericAddress(user.address);
        await expect(acceptInviteAddress)
          .to.emit(accountManager, "AcceptInviteAddress")
          .withArgs(accountId, spokeChainId, userAddr);
        await expect(acceptInviteAddress).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });
    });

    describe("Unregister address", () => {
      it("Should successfully call unregister address", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call unregister address
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const unregisterChainId: string = convertNumberToBytes(spokeChainId, UINT16_LENGTH);
        const payload = buildMessagePayload(
          Action.UnregisterAddress,
          accountId,
          user.address,
          ethers.concat([unregisterChainId])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const unregisterAddress = await bridgeRouter.receiveMessage(message);

        // verify unregister address is called
        await expect(unregisterAddress)
          .to.emit(accountManager, "UnregisterAddress(bytes32,uint16)")
          .withArgs(accountId, unregisterChainId);
        await expect(unregisterAddress).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call unregister address
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const unregisterChainId: string = convertNumberToBytes(spokeChainId, UINT16_LENGTH);
        const payload = buildMessagePayload(
          Action.UnregisterAddress,
          accountId,
          user.address,
          ethers.concat([unregisterChainId])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const unregisterAddress = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(unregisterAddress).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Add Delegate", () => {
      it("Should successfully call add delegate", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call add delegate
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const delegateAddr: string = getRandomAddress();
        const payload = buildMessagePayload(
          Action.AddDelegate,
          accountId,
          user.address,
          convertEVMAddressToGenericAddress(delegateAddr)
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const addDelegate = await bridgeRouter.receiveMessage(message);

        // verify add delegate is called
        await expect(addDelegate).to.emit(accountManager, "AddDelegate").withArgs(accountId, delegateAddr);
        await expect(addDelegate).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call add delegate
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const delegateAddr: string = getRandomAddress();
        const payload = buildMessagePayload(
          Action.AddDelegate,
          accountId,
          user.address,
          convertEVMAddressToGenericAddress(delegateAddr)
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const addDelegate = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(addDelegate).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Remove Delegate", () => {
      it("Should successfully call remove delegate", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call remove delegate
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const delegateAddr: string = getRandomAddress();
        const payload = buildMessagePayload(
          Action.RemoveDelegate,
          accountId,
          user.address,
          convertEVMAddressToGenericAddress(delegateAddr)
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const removeDelegate = await bridgeRouter.receiveMessage(message);

        // verify remove delegate is called
        await expect(removeDelegate).to.emit(accountManager, "RemoveDelegate").withArgs(accountId, delegateAddr);
        await expect(removeDelegate).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call remove delegate
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const delegateAddr: string = getRandomAddress();
        const payload = buildMessagePayload(
          Action.RemoveDelegate,
          accountId,
          user.address,
          convertEVMAddressToGenericAddress(delegateAddr)
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const removeDelegate = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(removeDelegate).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Create User Loan", () => {
      it("Should successfully call create user loan", async () => {
        const { user, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call create user loan
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const nonce: string = getRandomBytes(BYTES4_LENGTH);
        const loanTypeId: number = 0;
        const loanName: string = getRandomBytes(BYTES32_LENGTH);
        const payload = buildMessagePayload(
          Action.CreateLoan,
          accountId,
          user.address,
          ethers.concat([nonce, convertNumberToBytes(loanTypeId, UINT16_LENGTH), loanName])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const createUserLoan = await bridgeRouter.receiveMessage(message);

        // verify create user loan is called
        await expect(createUserLoan)
          .to.emit(loanManager, "CreateUserLoan")
          .withArgs(ethers.zeroPadBytes(nonce, BYTES32_LENGTH), accountId, loanTypeId, loanName);
        await expect(createUserLoan).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call create user loan
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const nonce: string = getRandomBytes(BYTES4_LENGTH);
        const loanTypeId: number = 0;
        const payload = buildMessagePayload(
          Action.CreateLoan,
          accountId,
          user.address,
          ethers.concat([nonce, convertNumberToBytes(loanTypeId, UINT16_LENGTH)])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const createUserLoan = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(createUserLoan).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Delete User Loan", () => {
      it("Should successfully call delete user loan", async () => {
        const { user, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call delete user loan
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const loanTypeId: number = 0;
        const payload = buildMessagePayload(
          Action.DeleteLoan,
          accountId,
          user.address,
          ethers.concat([loanId, convertNumberToBytes(loanTypeId, UINT16_LENGTH)])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const deleteUserLoan = await bridgeRouter.receiveMessage(message);

        // verify delete user loan is called
        await expect(deleteUserLoan)
          .to.emit(loanManager, "DeleteUserLoan(bytes32,bytes32)")
          .withArgs(loanId, accountId);
        await expect(deleteUserLoan).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call delete user loan
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const loanTypeId: number = 0;
        const payload = buildMessagePayload(
          Action.DeleteLoan,
          accountId,
          user.address,
          ethers.concat([loanId, convertNumberToBytes(loanTypeId, UINT16_LENGTH)])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const deleteUserLoan = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(deleteUserLoan).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Create User Loan and Deposit", () => {
      it("Should successfully call create user loan and deposit", async () => {
        const { user, poolId, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call create user loan and deposit
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const nonce: string = getRandomBytes(BYTES4_LENGTH);
        const amount: bigint = BigInt(1e18);
        const loanTypeId: number = 0;
        const loanName: string = getRandomBytes(BYTES32_LENGTH);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const createUserLoanAndDeposit = await bridgeRouter.receiveMessage(message);

        // verify create user loan and deposit are called
        const loanId = ethers.zeroPadBytes(nonce, BYTES32_LENGTH);
        await expect(createUserLoanAndDeposit)
          .to.emit(loanManager, "CreateUserLoan")
          .withArgs(ethers.zeroPadBytes(nonce, BYTES32_LENGTH), accountId, loanTypeId, loanName);
        await expect(createUserLoanAndDeposit)
          .to.emit(loanManager, "Deposit")
          .withArgs(loanId, accountId, poolId, amount);
        await expect(createUserLoanAndDeposit).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when cannot verify token received from user", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // check cannot verify token received
        await pool.setCanVerifyReceiveToken(false);
        await expect(pool.verifyReceiveToken(spokeChainId, convertEVMAddressToGenericAddress(spokeAddress))).to.be
          .reverted;

        // call create user loan and deposit
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const nonce: string = getRandomBytes(BYTES4_LENGTH);
        const amount: bigint = BigInt(1e18);
        const loanTypeId: number = 0;
        const loanName: string = getRandomBytes(BYTES32_LENGTH);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const createUserLoanAndDeposit = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = pool.interface.encodeErrorResult("CannotVerifyReceiveToken", [
          message.sourceChainId,
          message.sourceAddress,
        ]);
        await expect(createUserLoanAndDeposit).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call create user loan and deposit
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const loanTypeId: number = 0;
        const loanName: string = getRandomBytes(BYTES32_LENGTH);
        const payload = buildMessagePayload(
          Action.CreateLoanAndDeposit,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertNumberToBytes(loanTypeId, UINT16_LENGTH),
            loanName,
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const createUserLoanAndDeposit = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(createUserLoanAndDeposit).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Deposit", () => {
      it("Should successfully call deposit", async () => {
        const { user, poolId, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call deposit
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const deposit = await bridgeRouter.receiveMessage(message);

        // verify deposit is called
        await expect(deposit).to.emit(loanManager, "Deposit").withArgs(loanId, accountId, poolId, amount);
        await expect(deposit).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when cannot verify token received from user", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // check cannot verify token received
        await pool.setCanVerifyReceiveToken(false);
        await expect(pool.verifyReceiveToken(spokeChainId, convertEVMAddressToGenericAddress(spokeAddress))).to.be
          .reverted;

        // call deposit
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const deposit = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = pool.interface.encodeErrorResult("CannotVerifyReceiveToken", [
          message.sourceChainId,
          message.sourceAddress,
        ]);
        await expect(deposit).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call deposit
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const deposit = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(deposit).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Withdraw", () => {
      it("Should successfully call withdraw", async () => {
        const { user, poolId, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call withdraw
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const isFAmount: boolean = false;
        const payload = buildMessagePayload(
          Action.Withdraw,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(spokeChainId, UINT16_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertBooleanToByte(isFAmount),
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const withdraw = await bridgeRouter.receiveMessage(message);

        // verify withdraw is called
        await expect(withdraw).to.emit(loanManager, "Withdraw").withArgs(loanId, accountId, poolId, amount, isFAmount);
        await expect(withdraw).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should successfully call send token to user", async () => {
        const {
          user,
          pool,
          poolId,
          bridgeRouter,
          accountManager,
          loanManager,
          spokeChainId,
          spokeAddress,
          hubAddress,
        } = await loadFixture(deployHubFixture);

        // set deposit underlying amount
        const amount: bigint = BigInt(1e18);
        const underlyingAmount = amount + BigInt(0.2e18);
        await loanManager.setDepositUnderlyingAmount(underlyingAmount);

        // set user spoke address
        const userSpokeAddr = convertEVMAddressToGenericAddress(getRandomAddress());
        await accountManager.setAddressRegisteredToAccountOnChain(userSpokeAddr);
        expect(
          await accountManager.getAddressRegisteredToAccountOnChain(
            convertEVMAddressToGenericAddress(user.address),
            spokeChainId
          )
        ).to.equal(userSpokeAddr);

        // set send token message
        const returnAdapterId = BigInt(1);
        const returnGasLimit = BigInt(300000);
        const sendTokenMessage = await setSendTokenMessage(
          pool,
          returnAdapterId,
          returnGasLimit,
          hubAddress,
          spokeChainId,
          spokeAddress,
          convertGenericAddressToEVMAddress(userSpokeAddr),
          underlyingAmount,
          "0x"
        );

        // call withdraw
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const isFAmount: boolean = true;
        const payload = buildMessagePayload(
          Action.Withdraw,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(spokeChainId, UINT16_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertBooleanToByte(isFAmount),
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId,
          returnGasLimit,
        };
        const withdraw = await bridgeRouter.receiveMessage(message);

        // check pool called to get send token message
        await expect(withdraw)
          .to.emit(pool, "SendTokenMessage")
          .withArgs(
            bridgeRouter,
            returnAdapterId,
            returnGasLimit,
            accountId,
            spokeChainId,
            underlyingAmount,
            userSpokeAddr
          );

        // check message sent
        await expect(withdraw)
          .to.emit(bridgeRouter, "SendMessage")
          .withArgs(
            Object.values(sendTokenMessage.params),
            sendTokenMessage.sender,
            sendTokenMessage.destinationChainId,
            sendTokenMessage.handler,
            sendTokenMessage.payload,
            sendTokenMessage.finalityLevel,
            sendTokenMessage.extraArgs
          );
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call withdraw
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const isFAmount: boolean = false;
        const payload = buildMessagePayload(
          Action.Withdraw,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(spokeChainId, UINT16_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertBooleanToByte(isFAmount),
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const withdraw = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(withdraw).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Borrow", () => {
      it("Should successfully call borrow", async () => {
        const { user, poolId, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call borrow
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const maxStableRate: bigint = BigInt(0.1e18);
        const payload = buildMessagePayload(
          Action.Borrow,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(spokeChainId, UINT16_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertNumberToBytes(maxStableRate, UINT256_LENGTH),
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const borrow = await bridgeRouter.receiveMessage(message);

        // verify borrow is called
        await expect(borrow).to.emit(loanManager, "Borrow").withArgs(loanId, accountId, poolId, amount, maxStableRate);
        await expect(borrow).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should successfully call send token to user", async () => {
        const { user, pool, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // set user spoke address
        const userSpokeAddr = convertEVMAddressToGenericAddress(getRandomAddress());
        await accountManager.setAddressRegisteredToAccountOnChain(userSpokeAddr);
        expect(
          await accountManager.getAddressRegisteredToAccountOnChain(
            convertEVMAddressToGenericAddress(user.address),
            spokeChainId
          )
        ).to.equal(userSpokeAddr);

        // set send token message
        const returnAdapterId = BigInt(1);
        const returnGasLimit = BigInt(300000);
        const amount: bigint = BigInt(1e18);
        const sendTokenMessage = await setSendTokenMessage(
          pool,
          returnAdapterId,
          returnGasLimit,
          hubAddress,
          spokeChainId,
          spokeAddress,
          convertGenericAddressToEVMAddress(userSpokeAddr),
          amount,
          "0x"
        );

        // call borrow
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const maxStableRate: bigint = BigInt(0.1e18);
        const payload = buildMessagePayload(
          Action.Borrow,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(spokeChainId, UINT16_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertNumberToBytes(maxStableRate, UINT256_LENGTH),
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId,
          returnGasLimit,
        };
        const borrow = await bridgeRouter.receiveMessage(message);

        // check pool called to get send token message
        await expect(borrow)
          .to.emit(pool, "SendTokenMessage")
          .withArgs(bridgeRouter, returnAdapterId, returnGasLimit, accountId, spokeChainId, amount, userSpokeAddr);

        // check message sent
        await expect(borrow)
          .to.emit(bridgeRouter, "SendMessage")
          .withArgs(
            Object.values(sendTokenMessage.params),
            sendTokenMessage.sender,
            sendTokenMessage.destinationChainId,
            sendTokenMessage.handler,
            sendTokenMessage.payload,
            sendTokenMessage.finalityLevel,
            sendTokenMessage.extraArgs
          );
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call borrow
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const maxStableRate: bigint = BigInt(0.1e18);
        const payload = buildMessagePayload(
          Action.Borrow,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(spokeChainId, UINT16_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertNumberToBytes(maxStableRate, UINT256_LENGTH),
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const borrow = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(borrow).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Repay", () => {
      it("Should successfully call repay", async () => {
        const { user, poolId, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call repay
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const maxOverRepayment: bigint = BigInt(0.0001e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const repay = await bridgeRouter.receiveMessage(message);

        // verify repay is called
        await expect(repay).to.emit(loanManager, "Repay").withArgs(loanId, accountId, poolId, amount, maxOverRepayment);
        await expect(repay).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when cannot verify token received from user", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // check cannot verify token received
        await pool.setCanVerifyReceiveToken(false);
        await expect(pool.verifyReceiveToken(spokeChainId, convertEVMAddressToGenericAddress(spokeAddress))).to.be
          .reverted;

        // call repay
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const maxOverRepayment: bigint = BigInt(0.0001e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const repay = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = pool.interface.encodeErrorResult("CannotVerifyReceiveToken", [
          message.sourceChainId,
          message.sourceAddress,
        ]);
        await expect(repay).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call repay
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const maxOverRepayment: bigint = BigInt(0.0001e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const repay = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(repay).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Repay With Collateral", () => {
      it("Should successfully call repay with collateral", async () => {
        const { user, poolId, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call repay with collateral
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const repayWithCollateral = await bridgeRouter.receiveMessage(message);

        // verify repay with collateral is called
        await expect(repayWithCollateral)
          .to.emit(loanManager, "RepayWithCollateral")
          .withArgs(loanId, accountId, poolId, amount);
        await expect(repayWithCollateral).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call repay with collateral
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const repayWithCollateral = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(repayWithCollateral).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });

    describe("Switch Borrow Type", () => {
      it("Should successfully call switch borrow type", async () => {
        const { user, poolId, bridgeRouter, loanManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // call switch borrow type
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const maxStableRate: bigint = BigInt(0.1e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const switchBorrowType = await bridgeRouter.receiveMessage(message);

        // verify switch borrow type is called
        await expect(switchBorrowType)
          .to.emit(loanManager, "SwitchBorrowType")
          .withArgs(loanId, accountId, poolId, maxStableRate);
        await expect(switchBorrowType).to.emit(bridgeRouter, "MessageSucceeded").withArgs(message.messageId);
      });

      it("Should fail when sender is not registered to account", async () => {
        const { user, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // verify unregistered
        await accountManager.setIsAddressRegisteredToAccount(false);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const userAddr: string = convertEVMAddressToGenericAddress(user.address);
        expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

        // call switch borrow type
        const messageId: string = getRandomBytes(BYTES32_LENGTH);
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const maxStableRate: bigint = BigInt(0.1e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const switchBorrowType = await bridgeRouter.receiveMessage(message);

        // check failure
        const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
          accountId,
          message.sourceChainId,
          userAddr,
        ]);
        await expect(switchBorrowType).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });
    });
  });

  describe("Reverse Message", () => {
    it("Should fail when unknown payload action", async () => {
      const { user, hub, bridgeRouter, spokeChainId, spokeAddress, hubAddress } = await loadFixture(deployHubFixture);

      // call reverse message
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const payload = buildMessagePayload(Action.SendToken, accountId, user.address, "0x");
      const message: MessageReceived = {
        messageId,
        sourceChainId: BigInt(spokeChainId),
        sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
        handler: convertEVMAddressToGenericAddress(hubAddress),
        payload,
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };
      const extraArgs = "0x";
      const reverseMessage = bridgeRouter.reverseMessage(message, extraArgs);

      // check failure
      const errorReason = hub.interface.encodeErrorResult("CannotReverseMessage", [messageId]);
      await expect(reverseMessage).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
    });

    describe("Create Loan and Deposit", () => {
      it("Should fail when cannot verify token received from user", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // check cannot verify token received
        await pool.setCanVerifyReceiveToken(false);
        await expect(pool.verifyReceiveToken(spokeChainId, convertEVMAddressToGenericAddress(spokeAddress))).to.be
          .reverted;

        // call create user loan and deposit
        const messageId = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const nonce: string = getRandomBytes(BYTES4_LENGTH);
        const amount: bigint = BigInt(1e18);
        const loanTypeId: number = 0;
        const loanName: string = getRandomBytes(BYTES32_LENGTH);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const extraArgs = "0x";
        const createUserLoanAndDeposit = bridgeRouter.reverseMessage(message, extraArgs);

        // check failure
        const errorReason = pool.interface.encodeErrorResult("CannotVerifyReceiveToken", [
          message.sourceChainId,
          message.sourceAddress,
        ]);
        await expect(createUserLoanAndDeposit).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });

      it("Should successfully call send token to user with original account id", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // set send token message
        const returnAdapterId = BigInt(1);
        const returnGasLimit = BigInt(300000);
        const amount: bigint = BigInt(1e18);
        const sendTokenMessage = await setSendTokenMessage(
          pool,
          returnAdapterId,
          returnGasLimit,
          hubAddress,
          spokeChainId,
          spokeAddress,
          user.address,
          amount,
          "0x"
        );

        // call create user loan and deposit
        const messageId = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const nonce: string = getRandomBytes(BYTES4_LENGTH);
        const loanTypeId: number = 0;
        const loanName: string = getRandomBytes(BYTES32_LENGTH);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId,
          returnGasLimit,
        };
        const extraArgs = "0x";
        const createUserLoanAndDeposit = bridgeRouter.reverseMessage(message, extraArgs);

        // check pool called to get send token message
        await expect(createUserLoanAndDeposit)
          .to.emit(pool, "SendTokenMessage")
          .withArgs(
            bridgeRouter,
            returnAdapterId,
            returnGasLimit,
            accountId,
            spokeChainId,
            amount,
            convertEVMAddressToGenericAddress(user.address)
          );

        // check message sent
        await expect(createUserLoanAndDeposit)
          .to.emit(bridgeRouter, "SendMessage")
          .withArgs(
            Object.values(sendTokenMessage.params),
            sendTokenMessage.sender,
            sendTokenMessage.destinationChainId,
            sendTokenMessage.handler,
            sendTokenMessage.payload,
            sendTokenMessage.finalityLevel,
            sendTokenMessage.extraArgs
          );
      });
    });

    describe("Deposit", () => {
      it("Should fail when cannot verify token received from user", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // check cannot verify token received
        await pool.setCanVerifyReceiveToken(false);
        await expect(pool.verifyReceiveToken(spokeChainId, convertEVMAddressToGenericAddress(spokeAddress))).to.be
          .reverted;

        // call deposit
        const messageId = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const extraArgs = "0x";
        const deposit = bridgeRouter.reverseMessage(message, extraArgs);

        // check failure
        const errorReason = pool.interface.encodeErrorResult("CannotVerifyReceiveToken", [
          message.sourceChainId,
          message.sourceAddress,
        ]);
        await expect(deposit).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });

      it("Should successfully call send token to user with original account id", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // set send token message
        const returnAdapterId = BigInt(1);
        const returnGasLimit = BigInt(300000);
        const amount: bigint = BigInt(1e18);
        const sendTokenMessage = await setSendTokenMessage(
          pool,
          returnAdapterId,
          returnGasLimit,
          hubAddress,
          spokeChainId,
          spokeAddress,
          user.address,
          amount,
          "0x"
        );

        // call deposit
        const messageId = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
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
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId,
          returnGasLimit,
        };
        const extraArgs = "0x";
        const deposit = bridgeRouter.reverseMessage(message, extraArgs);

        // check pool called to get send token message
        await expect(deposit)
          .to.emit(pool, "SendTokenMessage")
          .withArgs(
            bridgeRouter,
            returnAdapterId,
            returnGasLimit,
            accountId,
            spokeChainId,
            amount,
            convertEVMAddressToGenericAddress(user.address)
          );

        // check message sent
        await expect(deposit)
          .to.emit(bridgeRouter, "SendMessage")
          .withArgs(
            Object.values(sendTokenMessage.params),
            sendTokenMessage.sender,
            sendTokenMessage.destinationChainId,
            sendTokenMessage.handler,
            sendTokenMessage.payload,
            sendTokenMessage.finalityLevel,
            sendTokenMessage.extraArgs
          );
      });
    });

    describe("Repay", () => {
      it("Should fail when cannot verify token received from user", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // check cannot verify token received
        await pool.setCanVerifyReceiveToken(false);
        await expect(pool.verifyReceiveToken(spokeChainId, convertEVMAddressToGenericAddress(spokeAddress))).to.be
          .reverted;

        // call repay
        const messageId = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const amount: bigint = BigInt(1e18);
        const maxOverRepayment: bigint = BigInt(0.0001e18);
        const isStableBorrow: boolean = false;
        const payload = buildMessagePayload(
          Action.Repay,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertNumberToBytes(maxOverRepayment, UINT256_LENGTH),
            convertBooleanToByte(isStableBorrow),
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId: BigInt(0),
          returnGasLimit: BigInt(0),
        };
        const extraArgs = "0x";
        const repay = bridgeRouter.reverseMessage(message, extraArgs);

        // check failure
        const errorReason = pool.interface.encodeErrorResult("CannotVerifyReceiveToken", [
          message.sourceChainId,
          message.sourceAddress,
        ]);
        await expect(repay).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
      });

      it("Should successfully call send token to user with overridden account id", async () => {
        const { user, pool, poolId, bridgeRouter, spokeChainId, spokeAddress, hubAddress } =
          await loadFixture(deployHubFixture);

        // set send token message
        const returnAdapterId = BigInt(1);
        const returnGasLimit = BigInt(300000);
        const amount: bigint = BigInt(1e18);
        const sendTokenMessage = await setSendTokenMessage(
          pool,
          returnAdapterId,
          returnGasLimit,
          hubAddress,
          spokeChainId,
          spokeAddress,
          user.address,
          amount,
          "0x"
        );

        // call repay
        const messageId = getRandomBytes(BYTES32_LENGTH);
        const accountId: string = getAccountIdBytes("ACCOUNT_ID");
        const loanId: string = getRandomBytes(BYTES32_LENGTH);
        const maxOverRepayment: bigint = BigInt(0.0001e18);
        const isStableBorrow: boolean = false;
        const payload = buildMessagePayload(
          Action.Repay,
          accountId,
          user.address,
          ethers.concat([
            loanId,
            convertNumberToBytes(poolId, UINT8_LENGTH),
            convertNumberToBytes(amount, UINT256_LENGTH),
            convertNumberToBytes(maxOverRepayment, UINT256_LENGTH),
            convertBooleanToByte(isStableBorrow),
          ])
        );
        const message: MessageReceived = {
          messageId,
          sourceChainId: BigInt(spokeChainId),
          sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
          handler: convertEVMAddressToGenericAddress(hubAddress),
          payload,
          returnAdapterId,
          returnGasLimit,
        };
        const overriddenAccountId = getAccountIdBytes("OVERRIDDEN_ACCOUNT_ID");
        const repay = bridgeRouter.reverseMessage(message, overriddenAccountId);

        // check pool called to get send token message
        await expect(repay)
          .to.emit(pool, "SendTokenMessage")
          .withArgs(
            bridgeRouter,
            returnAdapterId,
            returnGasLimit,
            overriddenAccountId,
            spokeChainId,
            amount,
            convertEVMAddressToGenericAddress(user.address)
          );

        // check message sent
        await expect(repay)
          .to.emit(bridgeRouter, "SendMessage")
          .withArgs(
            Object.values(sendTokenMessage.params),
            sendTokenMessage.sender,
            sendTokenMessage.destinationChainId,
            sendTokenMessage.handler,
            sendTokenMessage.payload,
            sendTokenMessage.finalityLevel,
            sendTokenMessage.extraArgs
          );
      });
    });

    it("Should fail when sender is not registered to account", async () => {
      const { user, poolId, bridgeRouter, accountManager, spokeChainId, spokeAddress, hubAddress } =
        await loadFixture(deployHubFixture);

      const returnAdapterId = BigInt(1);
      const returnGasLimit = BigInt(300000);
      const amount: bigint = BigInt(1e18);

      // verify unregistered
      await accountManager.setIsAddressRegisteredToAccount(false);
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const userAddr: string = convertEVMAddressToGenericAddress(user.address);
      expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;

      // call deposit
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const loanId: string = getRandomBytes(BYTES32_LENGTH);
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
      const message: MessageReceived = {
        messageId,
        sourceChainId: BigInt(spokeChainId),
        sourceAddress: convertEVMAddressToGenericAddress(spokeAddress),
        handler: convertEVMAddressToGenericAddress(hubAddress),
        payload,
        returnAdapterId,
        returnGasLimit,
      };
      const extraArgs = "0x";
      const reverseMessage = bridgeRouter.reverseMessage(message, extraArgs);

      // check failure
      const errorReason = accountManager.interface.encodeErrorResult("NotRegisteredToAccount", [
        accountId,
        message.sourceChainId,
        userAddr,
      ]);
      await expect(reverseMessage).to.emit(bridgeRouter, "MessageFailed").withArgs(messageId, errorReason);
    });
  });
});

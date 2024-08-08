import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { AccountManager__factory } from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
} from "../utils/bytes";
import { SECONDS_IN_DAY } from "../utils/time";

describe("AccountManager (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const HUB_ROLE = ethers.keccak256(convertStringToBytes("HUB"));

  async function deployAccountManagerFixture() {
    const [admin, hub, ...unusedUsers] = await ethers.getSigners();

    // deploy contract and set hub
    const accountManager = await new AccountManager__factory(admin).deploy(admin.address);
    await accountManager.grantRole(HUB_ROLE, hub);

    return { admin, hub, unusedUsers, accountManager };
  }

  async function createAccountFixture() {
    const { hub, unusedUsers: oldUnusedUsers, accountManager } = await loadFixture(deployAccountManagerFixture);

    const [user, ...unusedUsers] = oldUnusedUsers;

    const accountId: string = getAccountIdBytes("ACCOUNT_ID");
    const spokeChainId = 0;
    const userAddr = convertEVMAddressToGenericAddress(user.address);
    const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);
    const createAccount = await accountManager
      .connect(hub)
      .createAccount(accountId, spokeChainId, userAddr, refAccountId);

    return { hub, unusedUsers, accountManager, createAccount, accountId, spokeChainId, userAddr, refAccountId };
  }

  async function inviteAddressFixture() {
    const {
      hub,
      unusedUsers: oldUnusedUsers,
      accountManager,
      accountId,
      spokeChainId,
      userAddr,
    } = await loadFixture(createAccountFixture);
    const [inviteeUser, ...unusedUsers] = oldUnusedUsers;

    const inviteeChainId = 1;
    const inviteeUserAddr = convertEVMAddressToGenericAddress(inviteeUser.address);
    const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);
    const inviteAddress = await accountManager
      .connect(hub)
      .inviteAddress(accountId, inviteeChainId, inviteeUserAddr, refAccountId);

    return {
      hub,
      unusedUsers,
      accountManager,
      inviteAddress,
      accountId,
      spokeChainId,
      userAddr,
      inviteeChainId,
      inviteeUserAddr,
      refAccountId,
    };
  }

  async function addDelegateFixture() {
    const { hub, unusedUsers, accountManager, accountId, spokeChainId, userAddr } =
      await loadFixture(createAccountFixture);

    const delegateAddress = getRandomAddress();
    const addDelegate = await accountManager.connect(hub).addDelegate(accountId, delegateAddress);

    return {
      hub,
      unusedUsers,
      accountManager,
      addDelegate,
      accountId,
      spokeChainId,
      userAddr,
      delegateAddress,
    };
  }

  describe("Deployment", () => {
    it("Should set default admin and hub correctly", async () => {
      const { admin, hub, accountManager } = await loadFixture(deployAccountManagerFixture);

      // check default admin role
      expect(await accountManager.owner()).to.equal(admin.address);
      expect(await accountManager.defaultAdmin()).to.equal(admin.address);
      expect(await accountManager.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await accountManager.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await accountManager.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check hub role
      expect(await accountManager.getRoleAdmin(HUB_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await accountManager.hasRole(HUB_ROLE, hub.address)).to.be.true;
      expect(await accountManager.hasRole(HUB_ROLE, admin.address)).to.be.false;
    });
  });

  describe("Create Account", () => {
    it("Should fail to create account when sender is not hub", async () => {
      const { unusedUsers, accountManager } = await loadFixture(deployAccountManagerFixture);
      const sender = unusedUsers[0];

      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const chainId = 0;
      const userAddr = convertEVMAddressToGenericAddress(unusedUsers[1].address);
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);

      // create account using not hub
      const createAccount = accountManager.connect(sender).createAccount(accountId, chainId, userAddr, refAccountId);
      await expect(createAccount)
        .to.be.revertedWithCustomError(accountManager, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, HUB_ROLE);
    });

    it("Should successfuly create account", async () => {
      const { accountManager, accountId, spokeChainId, userAddr, refAccountId, createAccount } =
        await loadFixture(createAccountFixture);

      // verify account is created
      await expect(createAccount)
        .to.emit(accountManager, "CreateAccount")
        .withArgs(accountId, spokeChainId, userAddr, refAccountId);
      expect(await accountManager.isAccountCreated(accountId)).to.be.true;
      expect(await accountManager.isAddressRegistered(spokeChainId, userAddr)).to.be.true;
      expect(await accountManager.isAddressInvitedToAccount(accountId, spokeChainId, userAddr)).to.be.false;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.true;
      expect(await accountManager.getAccountIdOfAddressOnChain(userAddr, spokeChainId)).to.be.equal(accountId);
      await expect(accountManager.getAddressInvitedToAccountOnChain(accountId, spokeChainId)).to.be.reverted;
      expect(await accountManager.getAddressRegisteredToAccountOnChain(accountId, spokeChainId)).to.be.equal(userAddr);
    });

    it("Should successfuly create account with referrer", async () => {
      const {
        hub,
        unusedUsers,
        accountManager,
        accountId: refAccountId,
        spokeChainId,
      } = await loadFixture(createAccountFixture);
      const user = unusedUsers[0];

      // verify referrer is created
      expect(await accountManager.isAccountCreated(refAccountId)).to.be.true;

      // create account
      const accountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      const userAddr = convertEVMAddressToGenericAddress(user.address);
      const createAccount = await accountManager
        .connect(hub)
        .createAccount(accountId, spokeChainId, userAddr, refAccountId);

      // verify account is created
      await expect(createAccount)
        .to.emit(accountManager, "CreateAccount")
        .withArgs(accountId, spokeChainId, userAddr, refAccountId);
      expect(await accountManager.isAccountCreated(accountId)).to.be.true;
      expect(await accountManager.isAddressRegistered(spokeChainId, userAddr)).to.be.true;
      expect(await accountManager.isAddressInvitedToAccount(accountId, spokeChainId, userAddr)).to.be.false;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.true;
      expect(await accountManager.getAccountIdOfAddressOnChain(userAddr, spokeChainId)).to.be.equal(accountId);
      await expect(accountManager.getAddressInvitedToAccountOnChain(accountId, spokeChainId)).to.be.reverted;
      expect(await accountManager.getAddressRegisteredToAccountOnChain(accountId, spokeChainId)).to.be.equal(userAddr);
    });

    it("Should fail to create account when account id is empty", async () => {
      const { hub, unusedUsers, accountManager } = await loadFixture(deployAccountManagerFixture);

      const accountId: string = getAccountIdBytes("");
      const chainId = 0;
      const userAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);

      // create account with empty account id
      const createAccount = accountManager.connect(hub).createAccount(accountId, chainId, userAddr, refAccountId);
      await expect(createAccount)
        .to.be.revertedWithCustomError(accountManager, "AccountAlreadyCreated")
        .withArgs(accountId);
    });

    it("Should fail to create account when account id already in use", async () => {
      const { hub, unusedUsers, accountManager, accountId, spokeChainId, refAccountId } =
        await loadFixture(createAccountFixture);
      const user2Addr = convertEVMAddressToGenericAddress(unusedUsers[0].address);

      // verify account is created
      expect(await accountManager.isAccountCreated(accountId)).to.be.true;

      // create account with same account id
      const createAccount = accountManager.connect(hub).createAccount(accountId, spokeChainId, user2Addr, refAccountId);
      await expect(createAccount)
        .to.be.revertedWithCustomError(accountManager, "AccountAlreadyCreated")
        .withArgs(accountId);
    });

    it("Should fail to create account when address is already registered", async () => {
      const { hub, accountManager, spokeChainId, userAddr, refAccountId } = await loadFixture(createAccountFixture);

      // verify address is registered
      expect(await accountManager.isAddressRegistered(spokeChainId, userAddr)).to.be.true;

      // verify new account
      const newAccountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await accountManager.isAccountCreated(newAccountId)).to.be.false;

      // create new account with same user
      const createAccount = accountManager
        .connect(hub)
        .createAccount(newAccountId, spokeChainId, userAddr, refAccountId);
      await expect(createAccount)
        .to.be.revertedWithCustomError(accountManager, "AddressPreviouslyRegistered")
        .withArgs(spokeChainId, userAddr);
    });

    it("Should fail to create account when referrer is unknown", async () => {
      const { hub, unusedUsers, accountManager } = await loadFixture(deployAccountManagerFixture);
      const [user] = unusedUsers;

      // verify referrer account is not created
      const refAccountId: string = getAccountIdBytes("REFERRER");
      expect(await accountManager.isAccountCreated(refAccountId)).to.be.false;

      // create new account with unknown referrer
      const accountId: string = getAccountIdBytes("ACCOUNT_ID");
      const spokeChainId = 0;
      const userAddr = convertEVMAddressToGenericAddress(user.address);
      const createAccount = accountManager.connect(hub).createAccount(accountId, spokeChainId, userAddr, refAccountId);
      await expect(createAccount)
        .to.be.revertedWithCustomError(accountManager, "InvalidReferrerAccount")
        .withArgs(refAccountId);
    });
  });

  describe("Invite Address", () => {
    it("Should fail to invite address when sender is not hub", async () => {
      const { unusedUsers, accountManager, accountId } = await loadFixture(createAccountFixture);
      const sender = unusedUsers[0];

      const inviteeChainId = 1;
      const inviteeUserAddr = convertEVMAddressToGenericAddress(unusedUsers[1].address);
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);

      // invite address using not hub
      const inviteAddress = accountManager
        .connect(sender)
        .inviteAddress(accountId, inviteeChainId, inviteeUserAddr, refAccountId);
      await expect(inviteAddress)
        .to.be.revertedWithCustomError(accountManager, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, HUB_ROLE);
    });

    it("Should successfuly invite address", async () => {
      const { accountManager, inviteAddress, accountId, inviteeChainId, inviteeUserAddr, refAccountId } =
        await loadFixture(inviteAddressFixture);

      // verify invite
      await expect(inviteAddress)
        .to.emit(accountManager, "InviteAddress")
        .withArgs(accountId, inviteeChainId, inviteeUserAddr, refAccountId);
      expect(await accountManager.isAddressRegistered(inviteeChainId, inviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressInvitedToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.true;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.false;
      await expect(accountManager.getAccountIdOfAddressOnChain(inviteeUserAddr, inviteeChainId)).to.be.reverted;
      expect(await accountManager.getAddressInvitedToAccountOnChain(accountId, inviteeChainId)).to.be.equal(
        inviteeUserAddr
      );
      await expect(accountManager.getAddressRegisteredToAccountOnChain(accountId, inviteeChainId)).to.be.reverted;
    });

    it("Should successfuly invite address with referrer", async () => {
      const {
        hub,
        unusedUsers: oldUnusedUsers,
        accountManager,
        accountId: refAccountId,
        spokeChainId,
      } = await loadFixture(createAccountFixture);
      const [user, inviteeUser] = oldUnusedUsers;

      // verify referrer is created
      expect(await accountManager.isAccountCreated(refAccountId)).to.be.true;

      // create account and invite address
      const accountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      const userAddr = convertEVMAddressToGenericAddress(user.address);
      await accountManager.connect(hub).createAccount(accountId, spokeChainId, userAddr, refAccountId);
      const inviteeChainId = 1;
      const inviteeUserAddr = convertEVMAddressToGenericAddress(inviteeUser.address);
      const inviteAddress = await accountManager
        .connect(hub)
        .inviteAddress(accountId, inviteeChainId, inviteeUserAddr, refAccountId);

      // verify invite
      await expect(inviteAddress)
        .to.emit(accountManager, "InviteAddress")
        .withArgs(accountId, inviteeChainId, inviteeUserAddr, refAccountId);
      expect(await accountManager.isAddressRegistered(inviteeChainId, inviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressInvitedToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.true;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.false;
      await expect(accountManager.getAccountIdOfAddressOnChain(inviteeUserAddr, inviteeChainId)).to.be.reverted;
      expect(await accountManager.getAddressInvitedToAccountOnChain(accountId, inviteeChainId)).to.be.equal(
        inviteeUserAddr
      );
      await expect(accountManager.getAddressRegisteredToAccountOnChain(accountId, inviteeChainId)).to.be.reverted;
    });

    it("Should successfuly invite address and override existing invited address for same account+chain", async () => {
      const { hub, unusedUsers, accountManager, accountId, inviteeChainId, inviteeUserAddr } =
        await loadFixture(inviteAddressFixture);

      // verify existing invited address
      expect(await accountManager.isAddressInvitedToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.true;

      const newInviteeUserAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);

      // invite address to account
      const inviteAddress = accountManager
        .connect(hub)
        .inviteAddress(accountId, inviteeChainId, newInviteeUserAddr, refAccountId);

      // verify invite
      await expect(inviteAddress)
        .to.emit(accountManager, "InviteAddress")
        .withArgs(accountId, inviteeChainId, newInviteeUserAddr, refAccountId);
      expect(await accountManager.isAddressRegistered(inviteeChainId, inviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressRegistered(inviteeChainId, newInviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressInvitedToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressInvitedToAccount(accountId, inviteeChainId, newInviteeUserAddr)).to.be.true;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, inviteeChainId, newInviteeUserAddr)).to.be
        .false;
      await expect(accountManager.getAccountIdOfAddressOnChain(inviteeUserAddr, inviteeChainId)).to.be.reverted;
      await expect(accountManager.getAccountIdOfAddressOnChain(newInviteeUserAddr, inviteeChainId)).to.be.reverted;
      expect(await accountManager.getAddressInvitedToAccountOnChain(accountId, inviteeChainId)).to.be.equal(
        newInviteeUserAddr
      );
      await expect(accountManager.getAddressRegisteredToAccountOnChain(accountId, inviteeChainId)).to.be.reverted;
    });

    it("Should fail to invite address when unknown account", async () => {
      const { hub, unusedUsers, accountManager } = await loadFixture(createAccountFixture);

      // verify new account
      const newAccountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await accountManager.isAccountCreated(newAccountId)).to.be.false;

      const inviteeChainId = 1;
      const inviteeUserAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);

      // invite address to account
      const inviteAddress = accountManager
        .connect(hub)
        .inviteAddress(newAccountId, inviteeChainId, inviteeUserAddr, refAccountId);
      await expect(inviteAddress)
        .to.be.revertedWithCustomError(accountManager, "UnknownAccount")
        .withArgs(newAccountId);
    });

    it("Should fail to invite address when invitee already registered", async () => {
      const { hub, userAddr, accountManager, accountId, spokeChainId } = await loadFixture(createAccountFixture);

      // verify invitee registered
      expect(await accountManager.isAddressRegistered(spokeChainId, userAddr)).to.be.true;

      // invite address to account
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);
      const inviteAddress = accountManager.connect(hub).inviteAddress(accountId, spokeChainId, userAddr, refAccountId);
      await expect(inviteAddress)
        .to.be.revertedWithCustomError(accountManager, "AddressPreviouslyRegistered")
        .withArgs(spokeChainId, userAddr);
    });

    it("Should fail to invite address when existing registered address for same account+chain", async () => {
      const { hub, userAddr, unusedUsers, accountManager, accountId, spokeChainId } =
        await loadFixture(inviteAddressFixture);

      // verify existing registered address
      expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.true;

      const newInviteeUserAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const refAccountId: string = getEmptyBytes(BYTES32_LENGTH);

      // invite address to account
      const inviteAddress = accountManager
        .connect(hub)
        .inviteAddress(accountId, spokeChainId, newInviteeUserAddr, refAccountId);
      await expect(inviteAddress)
        .to.be.revertedWithCustomError(accountManager, "AccountHasAddressRegistered")
        .withArgs(accountId, spokeChainId);
    });

    it("Should fail to invite address when referrer is unknown", async () => {
      const { hub, unusedUsers, accountManager, accountId } = await loadFixture(createAccountFixture);

      // verify referrer account is not created
      const refAccountId: string = getAccountIdBytes("REFERRER");
      expect(await accountManager.isAccountCreated(refAccountId)).to.be.false;

      // invite address to account with unknown referrer
      const inviteeChainId = 1;
      const inviteeUserAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const inviteAddress = accountManager
        .connect(hub)
        .inviteAddress(accountId, inviteeChainId, inviteeUserAddr, refAccountId);
      await expect(inviteAddress)
        .to.be.revertedWithCustomError(accountManager, "InvalidReferrerAccount")
        .withArgs(refAccountId);
    });

    it("Should fail to invite address when referrer is yourself", async () => {
      const { hub, unusedUsers, accountManager, accountId } = await loadFixture(createAccountFixture);

      // invite address to account with yourself as referrer
      const inviteeChainId = 1;
      const inviteeUserAddr = convertEVMAddressToGenericAddress(unusedUsers[0].address);
      const refAccountId = accountId;
      const inviteAddress = accountManager
        .connect(hub)
        .inviteAddress(accountId, inviteeChainId, inviteeUserAddr, refAccountId);
      await expect(inviteAddress)
        .to.be.revertedWithCustomError(accountManager, "InvalidReferrerAccount")
        .withArgs(refAccountId);
    });
  });

  describe("Accept invite", () => {
    it("Should fail to accept invite when sender is not hub", async () => {
      const { unusedUsers, accountManager, accountId, inviteeChainId, inviteeUserAddr } =
        await loadFixture(inviteAddressFixture);

      const sender = unusedUsers[0];

      // accept invite using not hub
      const acceptInvite = accountManager
        .connect(sender)
        .acceptInviteAddress(accountId, inviteeChainId, inviteeUserAddr);
      await expect(acceptInvite)
        .to.be.revertedWithCustomError(accountManager, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, HUB_ROLE);
    });

    it("Should successfuly accept invite", async () => {
      const { hub, accountManager, accountId, inviteeChainId, inviteeUserAddr } =
        await loadFixture(inviteAddressFixture);

      // accept invite
      const acceptInvite = accountManager.connect(hub).acceptInviteAddress(accountId, inviteeChainId, inviteeUserAddr);

      // verify accept
      await expect(acceptInvite)
        .to.emit(accountManager, "AcceptInviteAddress")
        .withArgs(accountId, inviteeChainId, inviteeUserAddr);
      expect(await accountManager.isAddressRegistered(inviteeChainId, inviteeUserAddr)).to.be.true;
      expect(await accountManager.isAddressInvitedToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.true;
      expect(await accountManager.getAccountIdOfAddressOnChain(inviteeUserAddr, inviteeChainId)).to.be.equal(accountId);
      await expect(accountManager.getAddressInvitedToAccountOnChain(accountId, inviteeChainId)).to.be.reverted;
      expect(await accountManager.getAddressRegisteredToAccountOnChain(accountId, inviteeChainId)).to.be.equal(
        inviteeUserAddr
      );
    });

    it("Should fail to invite address when unknown account", async () => {
      const { hub, accountManager, inviteeChainId, inviteeUserAddr } = await loadFixture(inviteAddressFixture);

      // verify new account
      const newAccountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await accountManager.isAccountCreated(newAccountId)).to.be.false;

      // accept invite
      const acceptInvite = accountManager
        .connect(hub)
        .acceptInviteAddress(newAccountId, inviteeChainId, inviteeUserAddr);
      await expect(acceptInvite).to.be.revertedWithCustomError(accountManager, "UnknownAccount").withArgs(newAccountId);
    });

    it("Should fail to accept invite when already registered", async () => {
      const { hub, userAddr, accountManager, accountId, spokeChainId } = await loadFixture(inviteAddressFixture);

      // verify existing registered address
      expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.true;

      // accept invite
      const acceptInvite = accountManager.connect(hub).acceptInviteAddress(accountId, spokeChainId, userAddr);
      await expect(acceptInvite)
        .to.be.revertedWithCustomError(accountManager, "AddressPreviouslyRegistered")
        .withArgs(spokeChainId, userAddr);
    });

    it("Should fail to accept invite when not invited", async () => {
      const { hub, accountManager, accountId, inviteeUserAddr } = await loadFixture(inviteAddressFixture);

      // verify not invited registered address
      const uninvitedChainId = 2;
      expect(await accountManager.isAddressInvitedToAccount(accountId, uninvitedChainId, inviteeUserAddr)).to.be.false;

      // accept invite
      const acceptInvite = accountManager
        .connect(hub)
        .acceptInviteAddress(accountId, uninvitedChainId, inviteeUserAddr);
      await expect(acceptInvite)
        .to.be.revertedWithCustomError(accountManager, "NotInvitedToAccount")
        .withArgs(accountId, uninvitedChainId, inviteeUserAddr);
    });
  });

  describe("Unregister address", () => {
    it("Should fail to unregister address when sender is not hub", async () => {
      const { unusedUsers, accountManager, accountId, spokeChainId } = await loadFixture(createAccountFixture);

      const sender = unusedUsers[0];

      // unregister address using not hub
      const unregisterAddress = accountManager.connect(sender).unregisterAddress(accountId, spokeChainId);
      await expect(unregisterAddress)
        .to.be.revertedWithCustomError(accountManager, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, HUB_ROLE);
    });

    it("Should successfuly de-register registered addresss", async () => {
      const { hub, userAddr, accountManager, accountId, spokeChainId } = await loadFixture(createAccountFixture);

      // unregister address
      const unregisterAddress = accountManager.connect(hub).unregisterAddress(accountId, spokeChainId);

      // verify unregistered
      await expect(unregisterAddress)
        .to.emit(accountManager, "UnregisterAddress")
        .withArgs(accountId, spokeChainId, userAddr);
      expect(await accountManager.isAccountCreated(accountId)).to.be.true;
      expect(await accountManager.isAddressRegistered(spokeChainId, userAddr)).to.be.false;
      expect(await accountManager.isAddressInvitedToAccount(accountId, spokeChainId, userAddr)).to.be.false;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, spokeChainId, userAddr)).to.be.false;
      await expect(accountManager.getAccountIdOfAddressOnChain(userAddr, spokeChainId)).to.be.reverted;
      await expect(accountManager.getAddressInvitedToAccountOnChain(accountId, spokeChainId)).to.be.reverted;
      await expect(accountManager.getAddressRegisteredToAccountOnChain(accountId, spokeChainId)).to.be.reverted;
    });

    it("Should successfuly de-invite invited address", async () => {
      const { hub, accountManager, accountId, inviteeChainId, inviteeUserAddr } =
        await loadFixture(inviteAddressFixture);

      // verify address is invited
      expect(await accountManager.isAddressInvitedToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.true;

      // unregister address
      const unregisterAddress = accountManager.connect(hub).unregisterAddress(accountId, inviteeChainId);

      await expect(unregisterAddress)
        .to.emit(accountManager, "UnregisterAddress")
        .withArgs(accountId, inviteeChainId, inviteeUserAddr);
      expect(await accountManager.isAccountCreated(accountId)).to.be.true;
      expect(await accountManager.isAddressRegistered(inviteeChainId, inviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressInvitedToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.false;
      expect(await accountManager.isAddressRegisteredToAccount(accountId, inviteeChainId, inviteeUserAddr)).to.be.false;
      await expect(accountManager.getAccountIdOfAddressOnChain(inviteeUserAddr, inviteeChainId)).to.be.reverted;
      await expect(accountManager.getAddressInvitedToAccountOnChain(accountId, inviteeChainId)).to.be.reverted;
      await expect(accountManager.getAddressRegisteredToAccountOnChain(accountId, inviteeChainId)).to.be.reverted;
    });

    it("Should fail to unregister address when unknown account", async () => {
      const { hub, accountManager, spokeChainId } = await loadFixture(createAccountFixture);

      // verify new account
      const newAccountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await accountManager.isAccountCreated(newAccountId)).to.be.false;

      // unregister address
      const unregisterAddress = accountManager.connect(hub).unregisterAddress(newAccountId, spokeChainId);
      await expect(unregisterAddress)
        .to.be.revertedWithCustomError(accountManager, "UnknownAccount")
        .withArgs(newAccountId);
    });

    it("Should fail to unregister address when no address to unregister", async () => {
      const { hub, accountManager, accountId, spokeChainId } = await loadFixture(createAccountFixture);

      // not spoke chain
      const unregisterChainId = 1;
      expect(unregisterChainId).to.not.equal(spokeChainId);

      // unregister address
      const unregisterAddress = accountManager.connect(hub).unregisterAddress(accountId, unregisterChainId);
      await expect(unregisterAddress)
        .to.be.revertedWithCustomError(accountManager, "NoAddressToUnregister")
        .withArgs(accountId, unregisterChainId);
    });
  });

  describe("Add Delegate", () => {
    it("Should fail to add delegate when sender is not hub", async () => {
      const { unusedUsers, accountManager, accountId } = await loadFixture(createAccountFixture);
      const sender = unusedUsers[0];

      // add delegate using not hub
      const addDelegate = accountManager.connect(sender).addDelegate(accountId, getRandomAddress());
      await expect(addDelegate)
        .to.be.revertedWithCustomError(accountManager, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, HUB_ROLE);
    });

    it("Should successfuly add delegate", async () => {
      const { accountManager, addDelegate, accountId, delegateAddress } = await loadFixture(addDelegateFixture);

      // verify add
      await expect(addDelegate).to.emit(accountManager, "AddDelegate").withArgs(accountId, delegateAddress);
      expect(await accountManager.isDelegate(accountId, delegateAddress)).to.be.true;
    });

    it("Should fail to add delegate when unknown account", async () => {
      const { hub, accountManager } = await loadFixture(createAccountFixture);

      // verify new account
      const newAccountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await accountManager.isAccountCreated(newAccountId)).to.be.false;

      // add delegate
      const addDelegate = accountManager.connect(hub).addDelegate(newAccountId, getRandomAddress());
      await expect(addDelegate).to.be.revertedWithCustomError(accountManager, "UnknownAccount").withArgs(newAccountId);
    });

    it("Should fail to add delegate when address is already added", async () => {
      const { hub, accountManager, accountId, delegateAddress } = await loadFixture(addDelegateFixture);

      // verify delegate added
      expect(await accountManager.isDelegate(accountId, delegateAddress)).to.be.true;

      // add delegate
      const addDelegate = accountManager.connect(hub).addDelegate(accountId, delegateAddress);
      await expect(addDelegate)
        .to.be.revertedWithCustomError(accountManager, "DelegateAlreadyAdded")
        .withArgs(accountId, delegateAddress);
    });
  });

  describe("Remove Delegate", () => {
    it("Should fail to remove delegate when sender is not hub", async () => {
      const { unusedUsers, accountManager, accountId, delegateAddress } = await loadFixture(addDelegateFixture);

      const sender = unusedUsers[0];

      // remove delegate using not hub
      const removeDelegate = accountManager.connect(sender).removeDelegate(accountId, delegateAddress);
      await expect(removeDelegate)
        .to.be.revertedWithCustomError(accountManager, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, HUB_ROLE);
    });

    it("Should successfuly remove delegate", async () => {
      const { hub, accountManager, accountId, delegateAddress } = await loadFixture(addDelegateFixture);

      // remove delegate
      const addDelegate = accountManager.connect(hub).removeDelegate(accountId, delegateAddress);
      await expect(addDelegate).to.emit(accountManager, "RemoveDelegate").withArgs(accountId, delegateAddress);
      expect(await accountManager.isDelegate(accountId, delegateAddress)).to.be.false;
    });

    it("Should fail to remove delegate when unknown account", async () => {
      const { hub, accountManager, delegateAddress } = await loadFixture(addDelegateFixture);

      // verify new account
      const newAccountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await accountManager.isAccountCreated(newAccountId)).to.be.false;

      // remove delegate
      const removeDelegate = accountManager.connect(hub).removeDelegate(newAccountId, delegateAddress);
      await expect(removeDelegate)
        .to.be.revertedWithCustomError(accountManager, "UnknownAccount")
        .withArgs(newAccountId);
    });

    it("Should fail to remove delegate when no address to remove", async () => {
      const { hub, accountManager, accountId } = await loadFixture(addDelegateFixture);

      // verify not delegate
      const delegateAddress = getRandomAddress();
      expect(await accountManager.isDelegate(accountId, delegateAddress)).to.be.false;

      // remove delegate
      const removeDelegate = accountManager.connect(hub).removeDelegate(accountId, delegateAddress);
      await expect(removeDelegate)
        .to.be.revertedWithCustomError(accountManager, "NoDelegateToRemove")
        .withArgs(accountId, delegateAddress);
    });
  });

  describe("Get Address Registered To Account On Chain", () => {
    it("Should fail to get address when unknown account", async () => {
      const { hub, accountManager, spokeChainId } = await loadFixture(createAccountFixture);

      // verify new account
      const newAccountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await accountManager.isAccountCreated(newAccountId)).to.be.false;

      // get address
      const getAddress = accountManager.connect(hub).getAddressRegisteredToAccountOnChain(newAccountId, spokeChainId);
      await expect(getAddress).to.be.revertedWithCustomError(accountManager, "UnknownAccount").withArgs(newAccountId);
    });

    it("Should fail to get address when no address registered to account", async () => {
      const { hub, accountManager, accountId, spokeChainId } = await loadFixture(createAccountFixture);

      // not spoke chain
      const unknownChainId = 24;
      expect(unknownChainId).to.not.equal(spokeChainId);

      // get address
      const getAddress = accountManager.connect(hub).getAddressRegisteredToAccountOnChain(accountId, unknownChainId);
      await expect(getAddress)
        .to.be.revertedWithCustomError(accountManager, "NoAddressRegisterd")
        .withArgs(accountId, unknownChainId);
    });
  });

  describe("Get Address Invited To Account On Chain", () => {
    it("Should fail to get address when unknown account", async () => {
      const { hub, accountManager, spokeChainId } = await loadFixture(createAccountFixture);

      // verify new account
      const newAccountId: string = getAccountIdBytes("NEW_ACCOUNT_ID");
      expect(await accountManager.isAccountCreated(newAccountId)).to.be.false;

      // get address
      const getAddress = accountManager.connect(hub).getAddressInvitedToAccountOnChain(newAccountId, spokeChainId);
      await expect(getAddress).to.be.revertedWithCustomError(accountManager, "UnknownAccount").withArgs(newAccountId);
    });

    it("Should fail to get address when no address invited to account", async () => {
      const { hub, accountManager, accountId, spokeChainId } = await loadFixture(createAccountFixture);

      // get address
      const getAddress = accountManager.connect(hub).getAddressInvitedToAccountOnChain(accountId, spokeChainId);
      await expect(getAddress)
        .to.be.revertedWithCustomError(accountManager, "NoAddressInvited")
        .withArgs(accountId, spokeChainId);
    });
  });
});

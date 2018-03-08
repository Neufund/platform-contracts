import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import { eventValue } from "./helpers/events";
import roles from "./helpers/roles";
import knownInterfaces from "./helpers/knownInterfaces";
import { deployUniverse } from "./helpers/deployContracts";
import { TriState } from "./helpers/triState";

const TestIdentityRecord = artifacts.require("TestIdentityRecord");
const RoleBasedAccessPolicy = artifacts.require("RoleBasedAccessPolicy");
const IdentityRegistry = artifacts.require("IdentityRegistry");

contract(
  "IdentityRegistry",
  ([_, platformLegalRepresentative, universeManager, identityManager, identity, identity2]) => {
    let universe;
    let identityRegistry;
    let testIdentityRecord;

    before(async () => {
      testIdentityRecord = await TestIdentityRecord.new();
    });

    beforeEach(async () => {
      universe = await deployUniverse(platformLegalRepresentative, universeManager);
      identityRegistry = await IdentityRegistry.new(universe.address);
      await universe.setSingleton(knownInterfaces.identityRegistry, identityRegistry.address, {
        from: universeManager,
      });
      const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
      await accessPolicy.setUserRole(
        identityManager,
        roles.identityManager,
        identityRegistry.address,
        TriState.Allow,
      );
    });

    function deserializeClaims(claims) {
      const claimsN = new web3.BigNumber(claims, 16);
      return referenceClaims(
        claimsN.mod(2).eq(1),
        claimsN
          .dividedToIntegerBy(2)
          .mod(2)
          .eq(1),
        claimsN
          .dividedToIntegerBy(4)
          .mod(2)
          .eq(1),
      );
    }

    function referenceClaims(hasKYC, isSophisticatedInvestor, hasBankAccount) {
      return [{ hasKyc: hasKYC }, { isSophisticatedInvestor }, { hasBankAccount }];
    }

    function toBytes32(hex) {
      return `0x${web3.padLeft(hex.slice(2), 64)}`;
    }

    function expectSetClaimsEvent(tx, i, oldClaims, newClaims) {
      const event = eventValue(tx, "LogSetClaims");
      expect(event).to.exist;
      expect(event.args.identity).to.eq(i);
      expect(event.args.oldClaims).to.be.bytes32(oldClaims);
      expect(event.args.newClaims).to.be.bytes32(newClaims);
    }

    it("should set claims", async () => {
      const newClaims = toBytes32("0x10298A90192083091920F90192809380");
      const tx = await identityRegistry.setClaims(identity, "0", newClaims, {
        from: identityManager,
      });
      prettyPrintGasCost("set claims", tx);
      expectSetClaimsEvent(tx, identity, "0", newClaims);
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32(newClaims);

      const newClaims2 = toBytes32("0xAB902000000000000000001");
      const tx2 = await identityRegistry.setClaims(identity, newClaims, newClaims2, {
        from: identityManager,
      });
      prettyPrintGasCost("overwrite claims", tx2);
      expectSetClaimsEvent(tx2, identity, newClaims, newClaims2);
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32(newClaims2);
    });

    it("should set various claims sets", async () => {
      const hasKYCandHasAccount = toBytes32("0x5");
      await identityRegistry.setClaims(identity, "0", hasKYCandHasAccount, {
        from: identityManager,
      });
      const expHasKYCandHasAccount = await identityRegistry.getClaims(identity);
      expect(deserializeClaims(expHasKYCandHasAccount)).to.deep.eq(
        referenceClaims(true, false, true),
      );

      const isSophisticated = toBytes32("0x2");
      await identityRegistry.setClaims(identity, hasKYCandHasAccount, isSophisticated, {
        from: identityManager,
      });
      const expIsSophisticated = await identityRegistry.getClaims(identity);
      expect(deserializeClaims(expIsSophisticated)).to.deep.eq(referenceClaims(false, true, false));

      const hasKyc = toBytes32("0x1");
      await identityRegistry.setClaims(identity, isSophisticated, hasKyc, {
        from: identityManager,
      });
      const expHasKyc = await identityRegistry.getClaims(identity);
      expect(deserializeClaims(expHasKyc)).to.deep.eq(referenceClaims(true, false, false));
    });

    it("should set multiple claims", async () => {
      const newClaims1 = toBytes32("0x10298A90192083091920F90192809380");
      const newClaims2 = toBytes32("0x9812AB9112199209981982739817");

      const tx = await identityRegistry.setMultipleClaims(
        [identity, identity2],
        ["0", "0"],
        [newClaims1, newClaims2],
        { from: identityManager },
      );
      prettyPrintGasCost("set 2 initial claims", tx);
      const events = tx.logs.filter(e => e.event === "LogSetClaims");
      expect(events.length).to.eq(2);
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32(newClaims1);
      expect(await identityRegistry.getClaims(identity2)).to.be.bytes32(newClaims2);

      // overwrite
      const newClaims3 = toBytes32("0xB990");
      const newClaims4 = toBytes32("0xA091092DF");

      const tx2 = await identityRegistry.setMultipleClaims(
        [identity2, identity],
        [newClaims2, newClaims1],
        [newClaims4, newClaims3],
        { from: identityManager },
      );
      prettyPrintGasCost("set 2 overwrite claims", tx2);
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32(newClaims3);
      expect(await identityRegistry.getClaims(identity2)).to.be.bytes32(newClaims4);
    });

    it("should reject on invalid oldClaims");

    it("should reject on invalid multiple oldClaims");

    it("should reject not on identity manager");

    it("should reject on multiple set claims when arrays not eq");

    it("should get empty claims for non existing identity", async () => {
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32("0x0");
    });

    for (let ii = 0; ii <= 8; ii += 1) {
      const claims = toBytes32(web3.toHex(ii));
      it(`should deserialize claims - ${claims}`, async () => {
        const structMap = await testIdentityRecord.getIdentityRecord(claims);
        expect(deserializeClaims(claims)).to.deep.eq(
          referenceClaims(structMap[0], structMap[1], structMap[2]),
        );
      });
    }

    // test IdentityRecord with added fields should be used to deserialize new and old claim set
    it("should deserialize upgraded claims ");
  },
);

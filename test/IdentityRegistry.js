import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import { eventValue } from "./helpers/events";
import { deployUniverse, deployIdentityRegistry, toBytes32 } from "./helpers/deployContracts";

const TestIdentityRecord = artifacts.require("TestIdentityRecord");

contract(
  "IdentityRegistry",
  ([
    _,
    platformLegalRepresentative,
    universeManager,
    identityManager,
    identity,
    identity2,
    randomAccount,
  ]) => {
    let universe;
    let identityRegistry;
    let testIdentityRecord;

    before(async () => {
      testIdentityRecord = await TestIdentityRecord.new();
    });

    beforeEach(async () => {
      [universe] = await deployUniverse(platformLegalRepresentative, universeManager);
      identityRegistry = await deployIdentityRegistry(universe, universeManager, identityManager);
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
        claimsN
          .dividedToIntegerBy(8)
          .mod(2)
          .eq(1),
      );
    }

    function referenceClaims(isVerified, isSophisticatedInvestor, hasBankAccount, accountFrozen) {
      return [{ isVerified }, { isSophisticatedInvestor }, { hasBankAccount }, { accountFrozen }];
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
        referenceClaims(true, false, true, false),
      );

      const isSophisticated = toBytes32("0x2");
      await identityRegistry.setClaims(identity, hasKYCandHasAccount, isSophisticated, {
        from: identityManager,
      });
      const expIsSophisticated = await identityRegistry.getClaims(identity);
      expect(deserializeClaims(expIsSophisticated)).to.deep.eq(
        referenceClaims(false, true, false, false),
      );

      const isVerified = toBytes32("0x1");
      await identityRegistry.setClaims(identity, isSophisticated, isVerified, {
        from: identityManager,
      });
      const expHasKyc = await identityRegistry.getClaims(identity);
      expect(deserializeClaims(expHasKyc)).to.deep.eq(referenceClaims(true, false, false, false));

      const isVerifiedAndFrozen = toBytes32("0x9");
      await identityRegistry.setClaims(identity, isVerified, isVerifiedAndFrozen, {
        from: identityManager,
      });
      const expIsVerifiedAndFrozen = await identityRegistry.getClaims(identity);
      expect(deserializeClaims(expIsVerifiedAndFrozen)).to.deep.eq(
        referenceClaims(true, false, false, true),
      );
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

    it("should reject on invalid oldClaims", async () => {
      // this should work
      const newClaims = toBytes32("0x10298A90192083091920F90192809380");
      const tx = await identityRegistry.setClaims(identity, "0", newClaims, {
        from: identityManager,
      });
      prettyPrintGasCost("set claims", tx);
      expectSetClaimsEvent(tx, identity, "0", newClaims);
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32(newClaims);

      // this one will fail, as we don't set the old claims right
      const evenNewerClaims = toBytes32("0x10298A90192083091920F90192809381");
      const invalidOldClaims = toBytes32("0x10298A90192083091920F90192809382");
      await expect(
        identityRegistry.setClaims(identity, invalidOldClaims, evenNewerClaims, {
          from: identityManager,
        }),
      ).to.revert;
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32(
        "0x10298A90192083091920F90192809380",
      );
    });

    it("should reject on invalid multiple oldClaims", async () => {
      const newClaims1 = toBytes32("0x10298A90192083091920F90192809380");
      const newClaims2 = toBytes32("0x9812AB9112199209981982739817");

      // first oldClaim is invalid
      await expect(
        identityRegistry.setMultipleClaims(
          [identity, identity2],
          [
            toBytes32("0x10298A90192083091920F90192BBBBBB"), // this should be 0 for the tx to work
            toBytes32("0x0"),
          ],
          [newClaims1, newClaims2],
          { from: identityManager },
        ),
      ).to.revert;
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32("0x0");
      expect(await identityRegistry.getClaims(identity2)).to.be.bytes32("0x0");

      // second oldClaim is invalid
      await expect(
        identityRegistry.setMultipleClaims(
          [identity, identity2],
          [
            toBytes32("0x0"),
            toBytes32("0x10298A90192083091920F90192BBBBBB"), // this should be 0 for the tx to work
          ],
          [newClaims1, newClaims2],
          { from: identityManager },
        ),
      ).to.revert;
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32("0x0");
      expect(await identityRegistry.getClaims(identity2)).to.be.bytes32("0x0");

      // both oldClaims are invalid
      await expect(
        identityRegistry.setMultipleClaims(
          [identity, identity2],
          [
            toBytes32("0x10298A90192083091920F90192BBBBBB"),
            toBytes32("0x10298A90192083091920F90192BBBBBB"),
          ], // these should be 0 for the tx to work
          [newClaims1, newClaims2],
          { from: identityManager },
        ),
      ).to.revert;
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32("0x0");
      expect(await identityRegistry.getClaims(identity2)).to.be.bytes32("0x0");
    });

    it("should reject on not identity manager", async () => {
      const newClaims = toBytes32("0x10298A90192083091920F90192809380");
      await expect(
        identityRegistry.setClaims(identity, "0", newClaims, {
          from: randomAccount,
        }),
      ).to.revert;
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32("0");
    });

    it("should reject on multiple set claims when arrays not eq", async () => {
      const newClaims1 = toBytes32("0x10298A90192083091920F90192809380");
      const newClaims2 = toBytes32("0x9812AB9112199209981982739817");

      await expect(
        identityRegistry.setMultipleClaims(
          [identity, identity2],
          ["0", "0", "0"], // this array is too long!
          [newClaims1, newClaims2],
          { from: identityManager },
        ),
      ).to.revert;
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32("0x0");
      expect(await identityRegistry.getClaims(identity2)).to.be.bytes32("0x0");
    });

    it("should get empty claims for non existing identity", async () => {
      expect(await identityRegistry.getClaims(identity)).to.be.bytes32("0x0");
    });

    for (let ii = 0; ii <= 16; ii += 1) {
      const claims = toBytes32(web3.toHex(ii));
      /* eslint-disable no-loop-func */
      it(`should deserialize claims - ${claims}`, async () => {
        const structMap = await testIdentityRecord.getIdentityRecord(claims);
        expect(deserializeClaims(claims)).to.deep.eq(
          referenceClaims(structMap[0], structMap[1], structMap[2], structMap[3]),
        );
      });
    }

    // test IdentityRecord with added fields should be used to deserialize new and old claim set
    it("should deserialize upgraded claims ");
  },
);

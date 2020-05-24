import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import { eventValue } from "./helpers/events";
import { knownInterfaces } from "./helpers/knownInterfaces";
import registerSingletons from "./helpers/registerSingletons";
import { ZERO_ADDRESS } from "./helpers/constants";
import { contractId } from "./helpers/utils";
import { deployUniverse } from "./helpers/deployContracts";

contract(
  "Universe",
  ([_, platformLegalRepresentative, universeManager, other, other2, other3, other4]) => {
    let universe;
    let accessPolicy;
    let ethereumForkArbiter;

    beforeEach(async () => {
      [universe, accessPolicy, ethereumForkArbiter] = await deployUniverse(
        platformLegalRepresentative,
        universeManager,
      );
    });

    function expectSingletonSetEvent(tx, interfaceId, address, replacedAddress) {
      const event = eventValue(tx, "LogSetSingleton");
      expect(event).to.exist;
      expect(event.args.interfaceId).to.equal(interfaceId);
      expect(event.args.instance).to.equal(address);
      expect(event.args.replacedInstance).to.equal(replacedAddress);
    }

    function expectSetCollectionInterfaceEvent(tx, interfaceId, address, isset) {
      const event = eventValue(tx, "LogSetCollectionInterface");
      expect(event).to.exist;
      expect(event.args.interfaceId).to.equal(interfaceId);
      expect(event.args.instance).to.equal(address);
      expect(event.args.isSet).to.equal(isset);
    }

    it("should deploy", async () => {
      await prettyPrintGasCost("Deploy", universe);
      expect(await universe.accessPolicy()).to.eq(accessPolicy.address);
      expect(await universe.forkArbiter()).to.eq(ethereumForkArbiter.address);
      expect(await universe.getSingleton(knownInterfaces.accessPolicy)).to.eq(accessPolicy.address);
      expect(await universe.getSingleton(knownInterfaces.forkArbiter)).to.eq(
        ethereumForkArbiter.address,
      );
      expect(
        await universe.getManySingletons([
          knownInterfaces.forkArbiter,
          knownInterfaces.accessPolicy,
        ]),
      ).to.deep.eq([ethereumForkArbiter.address, accessPolicy.address]);
      expect(await universe.isSingleton(knownInterfaces.accessPolicy, accessPolicy.address)).to.be
        .true;
      expect(await universe.isSingleton(knownInterfaces.forkArbiter, ethereumForkArbiter.address))
        .to.be.true;
    });

    it("should set singleton", async () => {
      const tx = await universe.setSingleton(knownInterfaces.neumark, other, {
        from: universeManager,
      });
      expectSingletonSetEvent(tx, knownInterfaces.neumark, other, ZERO_ADDRESS);
      expect(await universe.getSingleton(knownInterfaces.neumark)).to.eq(other);
      expect(await universe.getManySingletons([knownInterfaces.neumark])).to.deep.eq([other]);
      expect(await universe.isSingleton(knownInterfaces.neumark, other)).to.be.true;
    });

    it("should set all known singletons", async () => {
      const regTx = await registerSingletons(universe, universeManager, [
        { ki: knownInterfaces.neumark, addr: other },
      ]);
      expectSingletonSetEvent(regTx, knownInterfaces.neumark, other, ZERO_ADDRESS);
      expect(await universe.getManySingletons([knownInterfaces.neumark])).to.deep.eq([other]);
      expect(await universe.neumark()).to.eq(other);

      const kis = [
        {
          ki: knownInterfaces.etherToken,
          addr: "0x498a042f52f1737a77b91dd8107e68d75bf9f478",
        },
        {
          ki: knownInterfaces.euroToken,
          addr: "0xd102445e80c56d36c7dcd968dc2792b87b236b46",
        },
        {
          ki: knownInterfaces.feeDisbursal,
          addr: "0xc22b7a02afa706b5bc2fdfc305288bd910812977",
        },
        {
          ki: knownInterfaces.platformPortfolio,
          addr: "0x4bee4641a18523d726a06841d8b57e2ce582e390",
        },
        {
          ki: knownInterfaces.euroLock,
          addr: "0x147df49452f805d1a35e7ca314f564d1087b112f",
        },
        {
          ki: knownInterfaces.etherLock,
          addr: "0x1608e04a05080150bbe5d33c95786016287f2990",
        },
        {
          ki: knownInterfaces.gasExchange,
          addr: "0x42194bf970666c3232f37dc39684a6937a65e2b9",
        },
        {
          ki: knownInterfaces.icbmEtherLock,
          addr: "0x1d5f6ed3ea6f3417b352d65333ea6eaaf6b1bb1d",
        },
        {
          ki: knownInterfaces.icbmEuroLock,
          addr: "0x4a882db40af31d2f7ae3cecd67d7a43e8ebf42f5",
        },
        {
          ki: knownInterfaces.identityRegistry,
          addr: "0x87c308a3f6752feadea2296a0c711ed31aa69c5f",
        },
        {
          ki: knownInterfaces.tokenExchange,
          addr: "0x147b317c8d0bdf72e3df3395d839af4bc581eebb",
        },
        {
          ki: knownInterfaces.tokenExchangeRateOracle,
          addr: "0x20216d0d0912d0a44cec2ffbc85043da6a943fda",
        },
        {
          ki: knownInterfaces.platformTerms,
          addr: "0x20216d0d0912d0a44cec2ffbc85043da6a943fdb",
        },
      ];
      const multiRegTx = await registerSingletons(universe, universeManager, kis);
      // find if number of events matches
      const events = multiRegTx.logs.filter(e => e.event === "LogSetSingleton");
      expect(events.length).to.eq(kis.length);
      // get all known interfaces
      const knownInterfacesList = kis.map(({ ki }) => ki);
      const knownInstances = kis.map(({ addr }) => addr);
      expect(await universe.getManySingletons(knownInterfacesList)).to.deep.eq(knownInstances);
      // compare with convenience getters
      const getters = [
        "etherToken",
        "euroToken",
        "feeDisbursal",
        "platformPortfolio",
        "euroLock",
        "etherLock",
        "gasExchange",
        "icbmEtherLock",
        "icbmEuroLock",
        "identityRegistry",
        "tokenExchange",
        "tokenExchangeRateOracle",
        "platformTerms",
      ];
      for (let ii = 0; ii < kis.length; ii += 1) {
        const loopi = await universe[getters[ii]]();
        expect(loopi).to.eq(knownInstances[ii]);
      }
    });

    it("should set singleton without convenience method", async () => {
      const someId = "0x63452ff6";
      // set neumark to address other
      const tx = await universe.setSingleton(someId, other, {
        from: universeManager,
      });
      expectSingletonSetEvent(tx, someId, other, ZERO_ADDRESS);
      expect(await universe.getSingleton(someId)).to.eq(other);
      expect(await universe.getManySingletons([someId])).to.deep.eq([other]);
      expect(await universe.isSingleton(someId, other)).to.be.true;
      expect(await universe.isSingleton(someId, other2)).to.be.false;
    });

    it("should replace singleton", async () => {
      // set neumark to address other
      let tx = await universe.setSingleton(knownInterfaces.neumark, other, {
        from: universeManager,
      });
      expectSingletonSetEvent(tx, knownInterfaces.neumark, other, ZERO_ADDRESS);
      expect(await universe.getSingleton(knownInterfaces.neumark)).to.eq(other);
      expect(await universe.getManySingletons([knownInterfaces.neumark])).to.deep.eq([other]);
      expect(await universe.isSingleton(knownInterfaces.neumark, other)).to.be.true;
      expect(await universe.isSingleton(knownInterfaces.neumark, other2)).to.be.false;

      // set neumark to address other2
      tx = await universe.setSingleton(knownInterfaces.neumark, other2, {
        from: universeManager,
      });
      expectSingletonSetEvent(tx, knownInterfaces.neumark, other2, other);
      expect(await universe.getSingleton(knownInterfaces.neumark)).to.eq(other2);
      expect(await universe.getManySingletons([knownInterfaces.neumark])).to.deep.eq([other2]);
      expect(await universe.isSingleton(knownInterfaces.neumark, other)).to.be.false;
      expect(await universe.isSingleton(knownInterfaces.neumark, other2)).to.be.true;
    });

    it("should check not set singleton false", async () => {
      expect(await universe.isSingleton(knownInterfaces.neumark, other)).to.be.false;
      expect(await universe.isSingleton(knownInterfaces.etherToken, other2)).to.be.false;
    });

    it("should change many singletons", async () => {
      await universe.setManySingletons(
        [knownInterfaces.neumark, knownInterfaces.etherToken],
        [other, other2],
        {
          from: universeManager,
        },
      );
      expect(await universe.isSingleton(knownInterfaces.neumark, other)).to.be.true;
      expect(await universe.isSingleton(knownInterfaces.etherToken, other2)).to.be.true;
      expect(await universe.getSingleton(knownInterfaces.neumark)).to.eq(other);
      expect(await universe.getSingleton(knownInterfaces.etherToken)).to.eq(other2);

      await universe.setManySingletons(
        [knownInterfaces.neumark, knownInterfaces.etherToken],
        [other3, other4],
        {
          from: universeManager,
        },
      );
      expect(await universe.isSingleton(knownInterfaces.neumark, other3)).to.be.true;
      expect(await universe.isSingleton(knownInterfaces.etherToken, other4)).to.be.true;
      expect(await universe.getSingleton(knownInterfaces.neumark)).to.eq(other3);
      expect(await universe.getSingleton(knownInterfaces.etherToken)).to.eq(other4);
      expect(await universe.isSingleton(knownInterfaces.neumark, other)).to.be.false;
      expect(await universe.isSingleton(knownInterfaces.etherToken, other2)).to.be.false;
    });

    it("should reject on set multiple singletons when arrays not eq", async () => {
      await expect(
        universe.setManySingletons(
          [
            knownInterfaces.neumark,
            knownInterfaces.etherToken,
            knownInterfaces.equityTokenInterface,
          ],
          [other, other2],
          {
            from: universeManager,
          },
        ),
      ).to.revert;
    });

    it("should set interface in collection", async () => {
      const addr = "0x20216d0d0912d0a44cec2ffbc85043da6a943fda";
      const tx = await universe.setCollectionInterface(
        knownInterfaces.commitmentInterface,
        addr,
        true,
        { from: universeManager },
      );
      expectSetCollectionInterfaceEvent(tx, knownInterfaces.commitmentInterface, addr, true);
      expect(
        await universe.isInterfaceCollectionInstance(knownInterfaces.commitmentInterface, addr),
      ).to.be.true;
    });

    // test isAnyOfInterfaceCollectionInstance: no match, single match (first), single match (second), all match
    it("should set multiple interfaces in collection for single address", async () => {
      universe.setCollectionInterface(knownInterfaces.neumark, other, true, {
        from: universeManager,
      });
      universe.setCollectionInterface(knownInterfaces.etherToken, other, true, {
        from: universeManager,
      });
      universe.setCollectionInterface(knownInterfaces.equityTokenInterface, other, true, {
        from: universeManager,
      });

      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.commitmentInterface, knownInterfaces.euroLock],
          other,
        ),
      ).is.false;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.neumark, knownInterfaces.euroLock],
          other,
        ),
      ).is.true;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.commitmentInterface, knownInterfaces.equityTokenInterface],
          other,
        ),
      ).is.true;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [
            knownInterfaces.neumark,
            knownInterfaces.etherToken,
            knownInterfaces.equityTokenInterface,
          ],
          other,
        ),
      ).is.true;

      universe.setCollectionInterface(knownInterfaces.neumark, other, false, {
        from: universeManager,
      });
      universe.setCollectionInterface(knownInterfaces.etherToken, other, false, {
        from: universeManager,
      });
      universe.setCollectionInterface(knownInterfaces.equityTokenInterface, other, false, {
        from: universeManager,
      });

      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.commitmentInterface, knownInterfaces.euroLock],
          other,
        ),
      ).is.false;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.neumark, knownInterfaces.euroLock],
          other,
        ),
      ).is.false;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.commitmentInterface, knownInterfaces.equityTokenInterface],
          other,
        ),
      ).is.false;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [
            knownInterfaces.neumark,
            knownInterfaces.etherToken,
            knownInterfaces.equityTokenInterface,
          ],
          other,
        ),
      ).is.false;
    });

    it("should set interface in many collections", async () => {
      universe.setInterfaceInManyCollections(
        [knownInterfaces.neumark, knownInterfaces.etherToken, knownInterfaces.equityTokenInterface],
        other,
        true,
        {
          from: universeManager,
        },
      );

      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.commitmentInterface, knownInterfaces.euroLock],
          other,
        ),
      ).is.false;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.neumark, knownInterfaces.euroLock],
          other,
        ),
      ).is.true;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.commitmentInterface, knownInterfaces.equityTokenInterface],
          other,
        ),
      ).is.true;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [
            knownInterfaces.neumark,
            knownInterfaces.etherToken,
            knownInterfaces.equityTokenInterface,
          ],
          other,
        ),
      ).is.true;

      universe.setInterfaceInManyCollections(
        [knownInterfaces.neumark, knownInterfaces.etherToken, knownInterfaces.equityTokenInterface],
        other,
        false,
        {
          from: universeManager,
        },
      );

      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.commitmentInterface, knownInterfaces.euroLock],
          other,
        ),
      ).is.false;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.neumark, knownInterfaces.euroLock],
          other,
        ),
      ).is.false;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [knownInterfaces.commitmentInterface, knownInterfaces.equityTokenInterface],
          other,
        ),
      ).is.false;
      expect(
        await universe.isAnyOfInterfaceCollectionInstance(
          [
            knownInterfaces.neumark,
            knownInterfaces.etherToken,
            knownInterfaces.equityTokenInterface,
          ],
          other,
        ),
      ).is.false;
    });

    it("should replace interface in collection", async () => {
      universe.setCollectionInterface(knownInterfaces.neumark, other, true, {
        from: universeManager,
      });
      expect(await universe.isInterfaceCollectionInstance(knownInterfaces.neumark, other)).is.true;
      expect(await universe.isInterfaceCollectionInstance(knownInterfaces.neumark, other2)).is
        .false;
      universe.setCollectionInterface(knownInterfaces.neumark, other, false, {
        from: universeManager,
      });
      universe.setCollectionInterface(knownInterfaces.neumark, other2, true, {
        from: universeManager,
      });
      expect(await universe.isInterfaceCollectionInstance(knownInterfaces.neumark, other2)).is.true;
      expect(await universe.isInterfaceCollectionInstance(knownInterfaces.neumark, other)).is.false;
    });

    it("reject on set not from manager", async () => {
      await expect(
        universe.setSingleton(knownInterfaces.neumark, other, {
          from: other2,
        }),
      ).to.revert;
      await expect(
        universe.setCollectionInterface(knownInterfaces.neumark, other2, true, {
          from: other,
        }),
      ).to.revert;
      await expect(
        universe.setInterfaceInManyCollections(
          [
            knownInterfaces.neumark,
            knownInterfaces.etherToken,
            knownInterfaces.equityTokenInterface,
          ],
          other,
          true,
          {
            from: other,
          },
        ),
      ).to.revert;
    });

    it("should set and replace in instances", async () => {
      let regTx = await universe.setSingleton(knownInterfaces.neumark, other, {
        from: universeManager,
      });
      expectSingletonSetEvent(regTx, knownInterfaces.neumark, other, ZERO_ADDRESS);
      expect(await universe.getInterfacesOfInstance(other)).to.deep.eq([knownInterfaces.neumark]);
      // overwrite with itself
      regTx = await universe.setSingleton(knownInterfaces.neumark, other, {
        from: universeManager,
      });
      expect(await universe.getInterfacesOfInstance(other)).to.deep.eq([knownInterfaces.neumark]);
      expectSingletonSetEvent(regTx, knownInterfaces.neumark, other, other);
      // overwrite with new
      const addr = "0xd102445e80c56d36c7dcd968dc2792b87b236b46";
      regTx = await universe.setSingleton(knownInterfaces.neumark, addr, {
        from: universeManager,
      });
      // old instance dropped
      expect(await universe.getInterfacesOfInstance(other)).to.deep.eq([]);
      expect(await universe.getInterfacesOfInstance(addr)).to.deep.eq([knownInterfaces.neumark]);
      expectSingletonSetEvent(regTx, knownInterfaces.neumark, addr, other);
      // add few more
      await registerSingletons(universe, universeManager, [
        { ki: knownInterfaces.tokenExchangeRateOracle, addr },
        { ki: knownInterfaces.identityRegistry, addr },
      ]);
      expect(await universe.getInterfacesOfInstance(addr)).to.deep.eq([
        knownInterfaces.neumark,
        knownInterfaces.tokenExchangeRateOracle,
        knownInterfaces.identityRegistry,
      ]);
      // add to collection
      await universe.setCollectionInterface(knownInterfaces.commitmentInterface, addr, true, {
        from: universeManager,
      });
      expect(await universe.getInterfacesOfInstance(addr)).to.deep.eq([
        knownInterfaces.neumark,
        knownInterfaces.tokenExchangeRateOracle,
        knownInterfaces.identityRegistry,
        knownInterfaces.commitmentInterface,
      ]);
      // remove from collection
      await universe.setCollectionInterface(knownInterfaces.commitmentInterface, addr, false, {
        from: universeManager,
      });
      expect(await universe.getInterfacesOfInstance(addr)).to.deep.eq([
        knownInterfaces.neumark,
        knownInterfaces.tokenExchangeRateOracle,
        knownInterfaces.identityRegistry,
      ]);
    });

    // there is optimization for removing from last and not last position - test it
    it("should remove from instances not last position", async () => {
      // overwrite with new
      const addr = "0xd102445e80c56d36c7dcd968dc2792b87b236b46";
      await registerSingletons(universe, universeManager, [
        { ki: knownInterfaces.neumark, addr },
        { ki: knownInterfaces.tokenExchangeRateOracle, addr },
        { ki: knownInterfaces.identityRegistry, addr },
      ]);
      expect(await universe.getInterfacesOfInstance(addr)).to.deep.eq([
        knownInterfaces.neumark,
        knownInterfaces.tokenExchangeRateOracle,
        knownInterfaces.identityRegistry,
      ]);
      await universe.setSingleton(knownInterfaces.neumark, ZERO_ADDRESS, {
        from: universeManager,
      });
      expect(await universe.getInterfacesOfInstance(addr)).to.deep.eq([
        knownInterfaces.identityRegistry,
        knownInterfaces.tokenExchangeRateOracle,
      ]);
      const regZeroTx = await universe.setSingleton(
        knownInterfaces.identityRegistry,
        ZERO_ADDRESS,
        {
          from: universeManager,
        },
      );
      expect(await universe.getInterfacesOfInstance(addr)).to.deep.eq([
        knownInterfaces.tokenExchangeRateOracle,
      ]);
      expectSingletonSetEvent(regZeroTx, knownInterfaces.identityRegistry, ZERO_ADDRESS, addr);
    });

    it("should remove from last position", async () => {
      await universe.setSingleton(knownInterfaces.neumark, other, {
        from: universeManager,
      });
      expect(await universe.getInterfacesOfInstance(other)).to.deep.eq([knownInterfaces.neumark]);
      // overwrite with itself
      await universe.setSingleton(knownInterfaces.neumark, ZERO_ADDRESS, {
        from: universeManager,
      });
      expect(await universe.getInterfacesOfInstance(other)).to.deep.eq([]);
    });

    it("should introspect", async () => {
      const cid = await universe.contractId();
      expect(cid[0]).to.eq(contractId("Universe"));
    });

    it("should revert on setting KNOWN_INTERFACE_UNIVERSE singleton", async () => {
      await expect(
        universe.setSingleton(knownInterfaces.universe, universe.address, {
          from: universeManager,
        }),
      ).to.rejectedWith("NF_UNI_NO_UNIVERSE_SINGLETON");
    });

    it("should revert on setting KNOWN_INTERFACE_UNIVERSE singleton when setting many singletos", async () => {
      await expect(
        universe.setManySingletons([knownInterfaces.universe], [universe.address], {
          from: universeManager,
        }),
      ).to.to.rejectedWith("NF_UNI_NO_UNIVERSE_SINGLETON");
    });
  },
);

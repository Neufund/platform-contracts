require("babel-register");
const { etoFixtures } = require("./fixtures/etos");
const { Q18 } = require("../test/helpers/constants");
const { getConfig, getDeployerAccount } = require("./config");
const { loadEtoFixtures, getEtoFixtureByName } = require("./helpers");
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const toChecksumAddress = require("web3-utils").toChecksumAddress;
const stringify = require("../test/helpers/utils").stringify;
const { join } = require("path");
const fs = require("fs");

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);

  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  deployer.then(async () => {
    const DEPLOYER = getDeployerAccount(network, accounts);
    const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
    const universe = await Universe.deployed();
    const ExitController = artifacts.require(CONFIG.artifacts.EXIT_CONTROLLER);
    const savedEtoFixtures = loadEtoFixtures();
    const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
    const EuroTokenController = artifacts.require(CONFIG.artifacts.EURO_TOKEN_CONTROLLER);
    const euroToken = await EuroToken.at(await universe.euroToken());
    const euroTokenController = await EuroTokenController.at(await euroToken.tokenController());

    const exitControllers = {};

    for (const name of Object.keys(etoFixtures)) {
      const etoVars = etoFixtures[name];
      if (etoVars.exit) {
        console.log(`Deploying ExitContract for eto ${name} for ${etoVars.exit} Euros`);

        // deploy exit controller for eto fixture and register with universe
        const etoFixture = getEtoFixtureByName(savedEtoFixtures, name);
        const nominee = etoFixture.nominee;
        const exitController = await ExitController.new(universe.address, etoFixture.equityToken);
        await universe.setCollectionsInterfaces(
          [knownInterfaces.exitController],
          [exitController.address],
          [true],
          { from: DEPLOYER },
        );

        console.log(`Start exit with nominee transfer`);
        // set eur-t transfer whitelist for exit controller
        await euroTokenController.setAllowedTransferTo(exitController.address, true, {
          from: DEPLOYER,
        });
        await euroTokenController.setAllowedTransferFrom(exitController.address, true, {
          from: DEPLOYER,
        });

        // start exit from nominee, nominee will need enough funds in eur-t
        const exitAmount = Q18.mul(etoVars.exit);
        await euroToken.transfer["address,uint256,bytes"](exitController.address, exitAmount, "", {
          from: nominee,
        });

        // verify that payout has started
        const state = await exitController.state();
        if (state !== 1) {
          throw new Error("ExitController in incorrect state after deployment");
        }

        console.log(`Validate exit controller state is ${state}`);

        // save exit controller
        exitControllers[name] = stringify({
          address: toChecksumAddress(exitController.address),
          amount_eurt: exitAmount,
        });
      }
    }

    const exitControllerPath = join(__dirname, "../build/exit_controller_fixtures.json");
    fs.writeFile(exitControllerPath, JSON.stringify(exitControllers, null, 2), err => {
      if (err) throw new Error(err);
    });
  });
};

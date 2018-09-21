require("babel-register");
const deployETO = require("../migrations/deployETO").deployETO;
const getConfig = require("../migrations/config").getConfig;
const getDeployerAccount = require("../migrations/config").getDeployerAccount;

module.exports = async function deploy() {
  const CONFIG = getConfig(web3, "forked_live", []);
  const DEPLOYER = getDeployerAccount("forked_live", []);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const universe = await Universe.at("0x560687db44b19ce8347a2d35873dd95269ddf6bc");

  await deployETO(
    artifacts,
    DEPLOYER,
    CONFIG,
    universe,
    "0x00b1da87c22608f90f1e34759cd1291c8a4e4b25",
    "0x04befe8ab2ab7ce71c610a5dae0cbf826b6c4f7a",
  );
};

require("babel-register");
const getConfig = require("./config").getConfig;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);

  if (CONFIG.isLiveDeployment) {
    console.log("---------------------------------------------");
    console.log(
      // eslint-disable-next-line max-len
      `Must use ${CONFIG.addresses.PLATFORM_OPERATOR_REPRESENTATIVE} account to deploy agreements on live network`,
    );
    console.log("---------------------------------------------");
    return;
  }

  deployer.then(async () => {
    const neumark = await Neumark.deployed();
    const commitment = await Commitment.deployed();

    console.log("Amending agreements");
    await neumark.amendAgreement(CONFIG.NEUMARK_HOLDER_AGREEMENT, {
      from: CONFIG.addresses.PLATFORM_OPERATOR_REPRESENTATIVE,
    });
    await commitment.amendAgreement(CONFIG.RESERVATION_AGREEMENT, {
      from: CONFIG.addresses.PLATFORM_OPERATOR_REPRESENTATIVE,
    });
  });
};

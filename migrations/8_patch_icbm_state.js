require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  // skip fixtures on live deployment
  if (CONFIG.isLiveDeployment) return;

  const fas = getFixtureAccounts(accounts);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);

  async function commitDuringIcbm(fixtures, commitment, euroToken) {
    for (const [fixtureName, fixtureDefinition] of Object.entries(fixtures)) {
      if (fixtureDefinition && fixtureDefinition.icbmCommitment) {
        const {
          icbmCommitment: { ETH: ethCommitment, EUR: eurCommitment },
        } = fixtureDefinition || {};
        if (ethCommitment) {
          console.log(`Account ${fixtureName} commits ${ethCommitment} ETH during ICBM`);
          await commitment.commit({
            from: fixtureDefinition.address,
            value: CONFIG.Q18.mul(ethCommitment),
          });
        }
        if (eurCommitment) {
          console.log(`Account ${fixtureName} commits ${eurCommitment} EUR during ICBM`);
          const amountEur = CONFIG.Q18.mul(eurCommitment);
          await euroToken.deposit(fixtureDefinition.address, amountEur);
          await euroToken.approve(commitment.address, amountEur, {
            from: fixtureDefinition.address,
          });
          await commitment.commitEuro({ from: fixtureDefinition.address });
        }
      }
    }
  }

  deployer.then(async () => {
    const commitment = await Commitment.deployed();
    const euroToken = await ICBMEuroToken.deployed();
    console.log("set Commitment to public phase");
    await commitment._mockTransitionTo(1);
    await commitment._mockTransitionTo(2);
    console.log("Simulate commitment during ICBM");
    await commitDuringIcbm(fas, commitment, euroToken);
    console.log("set Commitment to final phase");
    await commitment._mockTransitionTo(3);
  });
};

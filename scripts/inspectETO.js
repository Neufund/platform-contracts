require("babel-register");
const checkETO = require("../migrations/deployETO").checkETO;
const getConfig = require("../migrations/config").getConfig;

module.exports = async function inspectETO() {
  const CONFIG = getConfig(web3, "localhost", []);
  await checkETO(artifacts, CONFIG, "0x57f1DC60dfBA309E84e752ff8d08A2B808eaBE4c");
};

/* eslint-disable no-console */

require("babel-register");
const commandLineArgs = require("command-line-args");
const checkETO = require("../migrations/deployETO").checkETO;
const getConfig = require("../migrations/config").getConfig;

module.exports = async function inspectETO() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "eto", type: String },
    { name: "exec", type: String, multiple: true, defaultOption: true },
  ];

  let options;
  try {
    options = commandLineArgs(optionDefinitions);
  } catch (e) {
    console.log(`Invalid command line: ${e}`);
    console.log(`Expected parameters:`);
    console.log(optionDefinitions);
    throw e;
  }

  const CONFIG = getConfig(web3, options.network, []);
  await checkETO(artifacts, CONFIG, options.eto, true);
};

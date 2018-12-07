/* eslint-disable no-console */

require("babel-register");
const commandLineArgs = require("command-line-args");
const deployWhitelist = require("../migrations/deployETO").deployWhitelist;
const getConfig = require("../migrations/config").getConfig;
const d3 = require("d3-dsv");
const fs = require("fs");

module.exports = async function inspectETO() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "eto", type: String },
    { name: "whitelist", type: String },
    { name: "dry-run", type: Boolean },
    { name: "verbose-rpc", type: Boolean },
    { name: "exec", type: String, multiple: true, defaultOption: true },
  ];

  let options;
  try {
    options = commandLineArgs(optionDefinitions);
  } catch (e) {
    console.log(`Invalid command line: ${e}`);
    console.log(`Expected parameters:`);
    console.log(optionDefinitions);
    console.log("Expected CSV format");
    console.log("Column 1: Name 'address' value: address of the investor");
    console.log(
      "Column 2: Name 'fixed slot amount' value: value of fixed slot as number or 0 when not in fixed slot",
    );
    console.log(
      "Column 3: Name 'discount' value: decimal fraction that represent discount - fraction of full token price. applies only to a fixed slot!",
    );
    throw e;
  }

  const CONFIG = getConfig(web3, options.network, []);
  console.log("Loading CSV file and parsing");
  const parsedCsv = d3.csvParse(fs.readFileSync(options.whitelist, "UTF-8"));
  const whitelist = parsedCsv.map(entry => ({
    address: entry.address,
    discountAmount: entry["fixed slot amount"],
    discount: entry.discount,
  }));
  console.log(options);
  await deployWhitelist(artifacts, CONFIG, options.eto, whitelist, options["dry-run"]);
};

/* eslint-disable no-console */

const moment = require("moment");
const stringify = require("../test/helpers/constants").stringify;
const Q18 = require("../test/helpers/constants").Q18;

export function wrong(s) {
  return ["\x1b[31m", s, "\x1b[0m"];
}

export function good(s) {
  return ["\x1b[32m", s, "\x1b[0m"];
}

export async function printConstants(contract) {
  for (const func of contract.abi) {
    if (func.type === "function" && func.constant && func.inputs.length === 0) {
      try {
        const output = await contract[func.name]();
        const display = stringify({ v: output }).v;
        console.log(`${func.name}:`, ...good(display));
      } catch (e) {
        console.log(`${func.name}`, ...wrong("REVERTED"));
      }
    }
  }
}

export function explainTerms(name, terms) {
  console.log(`\n${name}:`);
  for (const k of Object.keys(terms)) {
    if (typeof terms[k] === "object" && terms[k].constructor.name.includes("BigNumber")) {
      if (terms[k].gte(Q18.div(1000))) {
        console.log(`${k}: ${terms[k].toString(10)} == ${terms[k].div(Q18).toString(10)} * 10**18`);
      } else if (k.endsWith("_DURATION")) {
        const duration = moment.duration(terms[k].toNumber() * 1000);
        console.log(`${k}: ${terms[k].toString(10)} = ${duration.humanize()}`);
      } else {
        console.log(`${k}: ${terms[k].toString(10)}`);
      }
    } else {
      console.log(`${k}: ${terms[k]}`);
    }
  }
}

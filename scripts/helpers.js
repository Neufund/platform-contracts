/* eslint-disable no-console */

const moment = require("moment");
const Q18 = require("../test/helpers/constants").Q18;

export function wrong(s) {
  return ["\x1b[31m", s, "\x1b[0m"];
}

export function good(s) {
  return ["\x1b[32m", s, "\x1b[0m"];
}

function formatValue(prop, value) {
  if (typeof value === "object" && value.constructor.name.includes("BigNumber")) {
    if (value.gte(Q18.div(1000))) {
      return `${value.toString(10)} == ${value.div(Q18).toString(10)} * 10**18`;
    } else if (prop.endsWith("_DURATION")) {
      const duration = moment.duration(value.toNumber() * 1000);
      return `${value.toString(10)} = ${duration.humanize()}`;
    }
    return value.toString(10);
  }
  return value;
}

export async function printConstants(contract) {
  for (const func of contract.abi) {
    if (func.type === "function" && func.constant && func.inputs.length === 0) {
      try {
        const output = await contract[func.name]();
        const displayValue = formatValue(func.name, output);
        console.log(`${func.name}:`, ...good(displayValue));
      } catch (e) {
        console.log(`${func.name}`, ...wrong(`REVERTED ${e}`));
      }
    }
  }
}

export function explainTerms(name, terms) {
  console.log(`\n${name}:`);
  for (const k of Object.keys(terms)) {
    const displayValue = formatValue(k, terms[k]);
    console.log(`${k}: ${displayValue}`);
  }
}

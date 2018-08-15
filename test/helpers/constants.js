const Web3 = require("web3");

export const web3 = new Web3();
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const Q18 = web3.toBigNumber("10").pow(18);
export const hourInSeconds = 60 * 60;
export const dayInSeconds = 24 * hourInSeconds;
export const monthInSeconds = 30 * dayInSeconds;
export const daysToSeconds = sec => sec * dayInSeconds;

export function toBytes32(hexOrNumber) {
  let strippedHex = "0";
  if (Number.isInteger(hexOrNumber)) {
    strippedHex = hexOrNumber.toString(16);
  } else {
    strippedHex = hexOrNumber.slice(2);
  }
  return `0x${web3.padLeft(strippedHex, 64)}`;
}

export function findConstructor(artifact) {
  const abi = artifact.abi.find(a => a.type === "constructor");
  if (!abi) throw new Error(`constructor in ${artifact.contract_name} could not be found`);
  return abi;
}

export function camelCase(input) {
  return input.toLowerCase().replace(/_(.)/g, (match, group1) => group1.toUpperCase());
}

export const stringify = o => {
  const op = {};
  for (const p of Object.keys(o)) {
    if (o[p] == null) {
      op[p] = o[p];
    } else if (typeof o[p] === "string") {
      op[p] = o[p];
    } else if (typeof o[p][Symbol.iterator] === "function") {
      op[p] = Array.from(o[p]).map(e => e.toString(10));
    } else if (typeof o[p] === "object") {
      if (o[p].constructor.name.includes("BigNumber")) {
        op[p] = o[p].toString(10);
      } else {
        op[p] = stringify(o[p]);
      }
    } else {
      op[p] = o[p];
    }
  }
  return op;
};

const sha3 = require("web3-utils").sha3;

export function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

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

export const recoverBigNumbers = terms => {
  const mod = {};
  for (const k of Object.keys(terms)) {
    if (typeof terms[k] === "string") {
      // skip hexadecimals
      if (terms[k].startsWith("0x")) {
        mod[k] = terms[k];
      } else {
        // try to parse bignumbers
        try {
          mod[k] = new web3.BigNumber(terms[k]);
        } catch (e) {
          mod[k] = terms[k];
        }
      }
    } else if (typeof terms[k] === "boolean" || terms[k] === null) {
      mod[k] = terms[k];
    } else if (typeof terms[k] === "object") {
      if (terms[k].constructor && terms[k].constructor.name.includes("BigNumber")) {
        mod[k] = terms[k];
      } else {
        mod[k] = recoverBigNumbers(terms[k]);
      }
    } else {
      throw new Error(
        `Only boolean and string types are allowed in terms! Integers must be strings: ${k}: ${
          terms[k]
        } (${typeof terms[k]})`,
      );
    }
  }
  return mod;
};

export function contractId(contractName) {
  return web3.sha3(`neufund-platform:${contractName}`);
}

export function randomBytes32() {
  return sha3(web3.BigNumber.random().toString());
}

export function randomAddress() {
  return randomBytes32().substr(0, 42);
}

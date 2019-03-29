import { BigNumber } from "./bignumber";
import * as fs from "fs";

export function parseNmkDataset(fileName) {
  // parses CSV file generated from Mathematica. All numbers have 36 digits precision to approximate 18 decimals precision of Neumark token
  const lines = fs
    .readFileSync(fileName)
    .toString()
    .split("\n")
    .filter(line => line.length > 0);

  return lines.map(line => {
    const eurNmk = line.split(",");
    return [new BigNumber(eurNmk[0]).round(18, 4), new BigNumber(eurNmk[1]).round(18, 4)];
  });
}

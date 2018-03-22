import { Neumark } from "./contractWrappers/Neumark";
import * as Web3 from "web3";
import { promisify } from "bluebird";
import { EuroToken } from "./contractWrappers/EuroToken";
import { BigNumber } from 'bignumber.js';

const Q18 = new BigNumber(10).pow(18);

// address are deterministic for new testrpc runs
const neumarkAddress = "0x5de139dbbfd47dd1d2cd906348fd1887135b2804";
const euroTokenAddress = "0x3a32aa343fba264411ef47b00b195165738e4e6b";
const deployerAddress = "0xe6ac5629b9ade2132f42887fbbc3a3860afbd07b";

async function main() {
  const web3 = new Web3(
    new Web3.providers.HttpProvider("http://localhost:8545"),
  );

  console.log(web3.sha3("NeumarkIssuer"));

  const accounts = await promisify(web3.eth.getAccounts, {
    context: web3.eth,
  })();

  const neumarkBalance = Q18.multipliedBy(45);
  const neumarkToken = await Neumark.createAndValidate(web3, neumarkAddress);
  await neumarkToken
    .issueForEuroTx(neumarkBalance)
    .send({ gas: 1000000, gasPrice: 1000000000, from: deployerAddress });
  const neuBalance = await neumarkToken.balanceOf(deployerAddress);
  console.log("NEU balance: ", neuBalance.toString());

  const euroTokens = Q18.multipliedBy(123);
  const euroToken = await EuroToken.createAndValidate(web3, euroTokenAddress);
  await euroToken
    .depositTx(deployerAddress, euroTokens)
    .send({ gas: 1000000, gasPrice: 1000000000, from: deployerAddress });
  const eurBalance = await euroToken.balanceOf(deployerAddress);
  console.log("EURO balance: ", eurBalance.toString());
}

main().catch(console.error);

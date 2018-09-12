import { promisify, mineBlock } from "./evmCommands";

let firstTimeRequestedTime = true;

export async function latestTimestamp() {
  // this is done as a workaround for a bug when first requested block get return wrong timestamp
  if (firstTimeRequestedTime) {
    await mineBlock();
    firstTimeRequestedTime = false;
  }

  return (await promisify(web3.eth.getBlock)("latest")).timestamp;
}

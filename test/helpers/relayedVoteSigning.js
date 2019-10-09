const web3Utils = require("web3-utils");

// NOTE web3.personal.sign & web3.eth.sign were both erroring, so I built this workaround
const evmSign = function(address, message) {
  const id = Date.now();
  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync(
      {
        jsonrpc: "2.0",
        method: "eth_sign",
        params: [address, message],
        id,
      },
      (err, res) => (err ? reject(err) : resolve(res.result)),
    );
  });
};

// Create a signed message that @param voter wants to vote @param inFavor of the proposal with
// @param proposalIndex at the votingContract at address @param votingContract
export async function createSignedVote(proposalIndex, inFavor, voter, votingContract) {
  // using EIP 191 signature scheme version 0 (intended validator)
  const msg = web3Utils.soliditySha3(
    { type: "bytes1", value: "0x0" },
    { type: "address", value: votingContract },
    { type: "uint256", value: proposalIndex },
    { type: "bool", value: inFavor },
  );
  const sig = await evmSign(voter, msg);
  return {
    r: sig.substr(0, 66),
    s: "0x".concat(sig.substr(66, 64)),
    v: parseInt(sig.substr(130, 2), 16) + 27,
  };
}

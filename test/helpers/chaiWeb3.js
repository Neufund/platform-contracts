import invariant from "invariant";

const web3Utils = require("web3/lib/utils/utils");

export default function(chai) {
  const Assertion = chai.Assertion;

  Assertion.addMethod("bytes32", function bytes32Equals(expectedBytes32) {
    const bytes32 = this._obj;
    invariant(bytes32.length === 66, `${bytes32} must start with 0x and has 64 hex characters`);

    this.assert(
      web3Utils.toHex(bytes32) === this._obj,
      "expected #{this} to be a hex string",
      "expected #{this} to not be a hex string",
    );

    const bytes32BN = new web3.BigNumber(bytes32, 16);
    const expectedBytes32BN = new web3.BigNumber(expectedBytes32, 16);

    this.assert(
      bytes32BN.eq(expectedBytes32BN),
      "expected #{this} to be equal #{exp}",
      "expected #{this} to not be equal #{exp}",
      expectedBytes32,
    );
  });

  Assertion.addMethod("blockchainArrayOfSize", async function blockchainArrayOfSize(size) {
    invariant(size >= 0, "Size has to be >= 0");

    // I would love to hear ideas for better implementation

    const web3ArrayAccessor = this._obj;

    // negative indexes seems to not play nicely with web3 so we skip this case
    if (size !== 0) {
      try {
        await web3ArrayAccessor(size - 1);
      } catch (e) {
        this.assert(
          false,
          `expected web3 array to be size of ${size} but it looks like it's smaller`, // i think it's impossible to get an array name in this point
        );
      }
    }
  });

  Assertion.addMethod("respectGasLimit", function respectGasLimit(gasLimit) {
    invariant(gasLimit >= 0, "Gas has to be >= 0");

    if (process.env.SKIP_GAS_CHECKS) {
      return;
    }

    const object = this._obj;

    const usedGas = object.receipt.gasUsed;
    this.assert(usedGas <= gasLimit, `Consumed gas ${usedGas} is more than ${gasLimit} limit.`);
  });

  Assertion.addProperty("revert", async function revert() {
    try {
      await this._obj;
      this.assert(false, "Transaction did not revert.");
    } catch (error) {
      const invalidOpcode = error.message.search("invalid opcode") >= 0;
      this.assert(
        invalidOpcode,
        `Transaction did not revert with the right error. Error message was: ${error.message}`,
      );
    }
  });
}

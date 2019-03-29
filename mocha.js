import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import chaiBignumber from "chai-bignumber";

import BigNumber from "./test/helpers/bignumber";
import chaiWeb3 from "./test/helpers/chaiWeb3";

chai
  .use(chaiAsPromised)
  .use(chaiBignumber(BigNumber))
  .use(chaiWeb3);

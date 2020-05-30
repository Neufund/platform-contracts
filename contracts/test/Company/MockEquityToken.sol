pragma solidity 0.4.26;

import "../../Company/EquityToken.sol";
import "../MockSnapshotIdToken.sol";


contract MockEquityToken is
    EquityToken,
    MockSnapshotIdToken
{

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        IEquityTokenController controller,
        ETOTokenTerms etoTokenTerms,
        address nominee,
        address companyLegalRep
    )
        EquityToken(universe, controller, etoTokenTerms, nominee, companyLegalRep)
        public
    {}
}

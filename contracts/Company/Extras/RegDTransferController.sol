pragma solidity 0.4.26;

import "../PlaceholderEquityTokenController.sol";


contract RegDTransferController is
    PlaceholderEquityTokenController,
    IdentityRecord
{
    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep
    )
        public
        PlaceholderEquityTokenController(universe, companyLegalRep)
    {}

    //
    // Implements ITokenController
    //

    function onTransfer(address broker, address from, address to, uint256 amount)
        public
        constant
        returns (bool allow)
    {
        // ask base controller if transfers are enables
        allow = PlaceholderEquityTokenController.onTransfer(broker, from, to, amount);
        // control for reg d lock in in funded state
        if (allow && state() == GovState.Funded) {
            IIdentityRegistry registry = IIdentityRegistry(UNIVERSE.identityRegistry());
            IdentityClaims memory claims = deserializeClaims(registry.getClaims(from));
            // perform additional checks for token holders under reg-d regulations
            if (claims.requiresRegDAccreditation) {
                // deny transfer if in lockdown period is in place
                // first take a date at which ETO was successfully completed
                IETOCommitment commitment = IETOCommitment(commitmentObserver());
                // allow transfer if 1 year passed form the date tokens could be claimed
                allow = block.timestamp > commitment.startOf(ETOState.Claim) + 365 days;
            }
        }
    }
}

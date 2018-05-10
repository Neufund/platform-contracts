pragma solidity ^0.4.15;

import "../../ICBM/Commitment/ICBMCommitment.sol";


contract MockICBMCommitment is
    ICBMCommitment
{
    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        IAccessPolicy accessPolicy,
        IEthereumForkArbiter forkArbiter,
        int256 startDate,
        address platformWallet,
        Neumark neumark,
        EtherToken etherToken,
        ICBMEuroToken euroToken,
        ICBMLockedAccount etherLock,
        ICBMLockedAccount euroLock,
        uint256 capEurUlps,
        uint256 minTicketEurUlps,
        uint256 ethEurFraction
    )
        ICBMCommitment(accessPolicy, forkArbiter, startDate, platformWallet, neumark,
            etherToken, euroToken, etherLock, euroLock, capEurUlps, minTicketEurUlps, ethEurFraction)
        public
    {
    }

    ////////////////////////
    // Mocked functions
    ////////////////////////

    /// allows to force any state within commitment contract
    function _mockTransitionTo(State newState) public {
        transitionTo(newState);
    }
}

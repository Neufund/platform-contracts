pragma solidity 0.4.25;

import "../../ETO/ETOCommitment.sol";


contract MockETOCommitment is
    ETOCommitment
{
    ////////////////////////
    // Constructor
    ////////////////////////

    /// anyone may be a deployer, the platform acknowledges the contract by adding it to Universe Commitment collection
    constructor(
        Universe universe,
        address platformWallet,
        address nominee,
        address companyLegalRep,
        ETOTerms etoTerms,
        IEquityToken equityToken
    )
        ETOCommitment(
            universe,
            platformWallet,
            nominee,
            companyLegalRep,
            etoTerms,
            equityToken
        )
    public
    {
    }

    ////////////////////////
    // Mocked functions
    ////////////////////////

    // moves all timestamps so
    function _mockShiftBackTime(uint256 delta) public {
        for(uint256 ii = 0; ii<_pastStateTransitionTimes.length; ii += 1) {
            if(_pastStateTransitionTimes[ii] > 0) {
                assert(_pastStateTransitionTimes[ii] >= delta);
                _pastStateTransitionTimes[ii] -= uint32(delta);
            }
        }
    }

    function _mockPastTime(uint256 idx, uint256 timestamp) public {
        _pastStateTransitionTimes[idx] = uint32(timestamp);
    }

    function _mockStartDate(
        ETOTerms etoTerms,
        IEquityToken equityToken,
        uint256 startDate,
        uint256 logStartDate
    )
        external
    {
        assert(startDate < 0xFFFFFFFF);
        uint256 startAt = startOfInternal(ETOState.Whitelist);

        runStateMachine(uint32(startDate));

        emit LogTermsSet(msg.sender, address(etoTerms), address(equityToken));
        emit LogETOStartDateSet(msg.sender, startAt, logStartDate);
    }
}

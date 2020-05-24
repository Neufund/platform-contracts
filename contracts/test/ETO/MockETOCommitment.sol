pragma solidity 0.4.26;

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
        address nominee,
        address companyLegalRep,
        ETOTerms etoTerms,
        IEquityToken equityToken
    )
        ETOCommitment(
            universe,
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

    // moves all timestamps towards the past
    function _mockShiftBackTime(uint256 delta) public {
        for(uint256 ii = 0; ii<_pastStateTransitionTimes.length; ii += 1) {
            if(_pastStateTransitionTimes[ii] > 0) {
                assert(_pastStateTransitionTimes[ii] >= delta);
                _pastStateTransitionTimes[ii] -= uint32(delta);
            }
        }
    }

    // convenience function for moving all timestampts towards the past
   // such that the next state transition will occur in delta seconds
    // @dev maximum to be shifted is to three days before state transition
    function _shiftToBeforeNextState(uint32 delta) public {
        require(delta < 86400, "NF_MOCK_INVALID_DELTA");
        ETOState s = state();
        uint256 nextTransition = startOfInternal(ETOState(uint(s) + 1));
        require(nextTransition != 0 && nextTransition > now + delta, "NF_MOCK_INVALID_TRANSITION_TIME");
        _mockShiftBackTime(nextTransition - now - delta);
        // generate set start date if still in setup
        if (s == ETOState.Setup) {
            emit LogETOStartDateSet(msg.sender, nextTransition, nextTransition - delta);
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

        EQUITY_TOKEN = equityToken;
        runStateMachine(uint32(startDate));

        if (startAt == 0) {
            // log set terms only once
            emit LogTermsSet(msg.sender, address(etoTerms), address(equityToken));
        }
        emit LogETOStartDateSet(msg.sender, startAt, logStartDate);
    }

    //
    // Override IAgreement internal interface to allow mocking up agreements for fixtures
    //
    function mCanAmend(address /*legalRepresentative*/)
        internal
        returns (bool)
    {
        return true;
    }
}

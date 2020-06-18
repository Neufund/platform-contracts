pragma solidity 0.4.26;

import "../VotingCenter/VotingCenter.sol";


contract MockVotingCenter is VotingCenter {

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(IVotingController controller)
        public
        VotingCenter(controller)
    {}

    ////////////////////////
    // Public functions
    ////////////////////////

    function _shiftProposalDeadlines(bytes32 proposalId, uint256 delta)
        public
    {
        VotingProposal.Proposal storage p = ensureExistingProposal(proposalId);
        uint32[5] storage deadlines = p.deadlines;
        for(uint256 ii; ii < 5; ii += 1) {
            // storage writes not optimized. this is mock function never deployed on mainnet
            // so optimization disregarded
            deadlines[ii] = uint32(Math.sub(deadlines[ii], delta));
        }
    }
}

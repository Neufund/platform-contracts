pragma solidity 0.4.26;

import "../VotingCenter/IVotingController.sol";
import "../Universe.sol";
import "../KnownContracts.sol";


contract TestVotingController is IVotingController, KnownContracts {

    ////////////////////////
    // Constructor
    ////////////////////////
    constructor(Universe /*universe*/)
        public
    {}

    //
    // Implementation of IVotingController
    //

    function onAddProposal(bytes32 /*proposalId*/, address /*initiator*/, address /*token*/)
        public
        constant
        returns (bool)
    {
        return true;
    }

    function onChangeVotingController(address /*sender*/, IVotingController /*newController*/)
        public
        constant
        returns (bool)
    {
        return true;
    }

    //
    // Implementation of IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (VOTING_CONTROLLER, 0);
    }
}

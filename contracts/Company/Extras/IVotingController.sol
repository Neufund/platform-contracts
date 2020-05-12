pragma solidity 0.4.26;

import "../../Standards/IContractId.sol";


contract IVotingController is IContractId {
    // token must be NEU or equity token
    // if initiator is not equity token then proposals start in campaign mode
    // if token is NEU then default values must apply
    function onAddProposal(bytes32 proposalId, address initiator, address token)
        public
        constant
        returns (bool);

    /// @notice check wether the disbursal controller may be changed
    function onChangeVotingController(address sender, IVotingController newController)
        public
        constant
        returns (bool);
}

pragma solidity 0.4.26;

import "./IVotingController.sol";
import "../Universe.sol";
import "../KnownInterfaces.sol";
import "../KnownContracts.sol";


contract VotingController is
    IVotingController,
    KnownInterfaces,
    AccessRoles,
    KnownContracts
{

    ////////////////////////
    // Constants
    ////////////////////////
    // collection of interfaces that can initiators
    bytes4[] private ALLOWED_INITIATOR_INTERFACES = [KNOWN_INTERFACE_EQUITY_TOKEN_CONTROLLER];
    // collection of token interfaces that can be used for voting
    bytes4[] private ALLOWED_TOKEN_INTERFACES = [KNOWN_INTERFACE_EQUITY_TOKEN];

    ////////////////////////
    // Immutable state
    ////////////////////////
    Universe private UNIVERSE;
    IAccessPolicy private ACCESS_POLICY;
    address private NEUMARK;

    ////////////////////////
    // Constructor
    ////////////////////////
    constructor(Universe universe)
        public
    {
        UNIVERSE = universe;
        // cache services that will never change to save some gas
        NEUMARK = universe.neumark();
        ACCESS_POLICY = universe.accessPolicy();
    }

    //
    // Implementation of IVotingController
    //

    function onAddProposal(bytes32 /*proposalId*/, address initiator, address token)
        public
        constant
        returns (bool)
    {
        bool tokenAllowed = token == NEUMARK || UNIVERSE.isAnyOfInterfaceCollectionInstance(ALLOWED_TOKEN_INTERFACES, token);
        bool initiatorAllowed = UNIVERSE.isAnyOfInterfaceCollectionInstance(ALLOWED_INITIATOR_INTERFACES, initiator);

        return tokenAllowed && initiatorAllowed;
    }

    function onChangeVotingController(address sender, IVotingController newController)
        public
        constant
        returns (bool)
    {
        (bytes32 controllerContractId, ) = newController.contractId();
        return ACCESS_POLICY.allowed(sender, ROLE_VOTING_CENTERL_MANAGER, msg.sender, msg.sig) && controllerContractId == VOTING_CONTROLLER;
    }

    //
    // Implementation of IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (VOTING_CONTROLLER, 0);
    }
}

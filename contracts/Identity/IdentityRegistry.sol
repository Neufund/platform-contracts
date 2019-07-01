pragma solidity 0.4.26;

import "../AccessControl/AccessControlled.sol";
import "../AccessRoles.sol";
import "../Universe.sol";
import "./IIdentityRegistry.sol";
import "../Standards/IContractId.sol";


contract IdentityRegistry is
    IIdentityRegistry,
    AccessControlled,
    AccessRoles,
    IContractId
{

    ////////////////////////
    // Mutable state
    ////////////////////////

    mapping(address => bytes32) private _claims;

    ////////////////////////
    // Constructor functions
    ////////////////////////

    constructor(Universe universe)
        AccessControlled(universe.accessPolicy())
        public
    {}

    ////////////////////////
    // Public functions
    ////////////////////////

    function getClaims(address identity)
        public
        constant
        returns (bytes32 claims)
    {
        return _claims[identity];
    }

    function getMultipleClaims(address[] identities)
        public
        constant
        returns (bytes32[])
    {
        uint256 idx;
        bytes32[] memory claims = new bytes32[](identities.length);
        while(idx < identities.length)
        {
            claims[idx] = _claims[identities[idx]];
            idx += 1;
        }
        return claims;
    }

    function setClaims(address identity, bytes32 oldClaims, bytes32 newClaims)
        public
        only(ROLE_IDENTITY_MANAGER)
    {
        require(_claims[identity] == oldClaims);
        _claims[identity] = newClaims;
        emit LogSetClaims(identity, oldClaims, newClaims);
    }

    /// sets multiple claims in single transaction to save on gas
    function setMultipleClaims(address[] identities, bytes32[] oldClaims, bytes32[] newClaims)
        public
        only(ROLE_IDENTITY_MANAGER)
    {
        assert(identities.length == oldClaims.length);
        assert(identities.length == newClaims.length);

        uint256 idx;
        while(idx < identities.length) {
            require(_claims[identities[idx]] == oldClaims[idx]);
            _claims[identities[idx]] = newClaims[idx];
            emit LogSetClaims(identities[idx], oldClaims[idx], newClaims[idx]);
            idx += 1;
        }
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x5b9788bf65445f2230fa661a463fab851bece5fa9629bbacc6eb011af53b777f, 0);
    }
}

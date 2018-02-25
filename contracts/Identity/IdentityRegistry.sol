pragma solidity 0.4.15;

import '../AccessControl/AccessControlled.sol';
import '../AccessRoles.sol';
import '../EthereumForkArbiter.sol';
import "./IIdentityRegistry.sol";


contract IdentityRegistry is
    IIdentityRegistry,
    AccessControlled,
    AccessRoles
{
    ////////////////////////
    // Immutable state
    ////////////////////////

    IEthereumForkArbiter private ETHEREUM_FORK_ARBITER;

    ////////////////////////
    // Mutable state
    ////////////////////////

    mapping(address => bytes32) private _claims;

    ////////////////////////
    // Constructor functions
    ////////////////////////

    function IdentityRegistry(IAccessPolicy accessPolicy, IEthereumForkArbiter forkArbiter)
        AccessControlled(accessPolicy)
        public
    {
        require(forkArbiter != IEthereumForkArbiter(0x0));
        ETHEREUM_FORK_ARBITER = forkArbiter;
    }

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
        while(idx++ < identities.length)
        {
            claims[idx] = _claims[identities[idx]];
        }
        return claims;
    }

    function setClaims(address identity, bytes32 oldClaims, bytes32 newClaims)
        only(ROLE_IDENTITY_MANAGER)
        public
    {
        require(_claims[identity] == oldClaims);
        _claims[identity] = newClaims;
        LogSetClaims(identity, oldClaims, newClaims);
    }

    /// sets multiple claims in single transaction to save on gas
    function setMultipleClaims(address[] identities, bytes32[] oldClaims, bytes32[] newClaims)
        only(ROLE_IDENTITY_MANAGER)
        public
    {
        assert(identities.length == oldClaims.length);
        assert(identities.length == newClaims.length);

        uint256 idx = identities.length;
        while(--idx >= 0) {
            require(_claims[identities[idx]] == oldClaims[idx]);
            _claims[identities[idx]] = newClaims[idx];
            LogSetClaims(identities[idx], oldClaims[idx], newClaims[idx]);
        }
    }
}

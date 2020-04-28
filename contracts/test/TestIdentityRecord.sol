pragma solidity 0.4.26;

import "../Identity/IIdentityRegistry.sol";


contract TestIdentityRecord {

    ////////////////////////
    // Public functions
    ////////////////////////

    function getIdentityRecord(bytes32 claims) public pure returns (bool[6] deserializedClaims){
        IdentityRecord.IdentityClaims memory ds = IdentityRecord.deserializeClaims(claims);
        assembly {
            deserializedClaims := ds
        }
    }
}

pragma solidity 0.4.26;

import "../Identity/IIdentityRegistry.sol";


contract TestUpdatedIdentityRecord is IdentityRecord {

    ////////////////////////
    // Public functions
    ////////////////////////
    struct IdentityClaimsV2 {
        bool isVerified; // 1 bit
        bool isSophisticatedInvestor; // 1 bit
        bool hasBankAccount; // 1 bit
        bool accountFrozen; // 1 bit
        bool newProperty; // this is a new property to test the extension of the identity claims
        // uint252 reserved
    }

    function deserializeClaimsV2(bytes32 data) internal pure returns (IdentityClaimsV2 memory claims) {
        assembly {
            mstore(claims, and(data, 0x1))
            mstore(add(claims, 0x20), div(and(data, 0x2), 0x2))
            mstore(add(claims, 0x40), div(and(data, 0x4), 0x4))
            mstore(add(claims, 0x60), div(and(data, 0x8), 0x8))
            mstore(add(claims, 0x80), div(and(data, 0x10), 0x10))
        }
    }

    function getIdentityRecord(bytes32 claims) public pure returns (bool[5] deserializedClaims){
        IdentityClaimsV2 memory ds = deserializeClaimsV2(claims);
        assembly {
            deserializedClaims := ds
        }
    }
}

pragma solidity 0.4.26;


contract TestUpdatedIdentityRecord {

    ////////////////////////
    // Public functions
    ////////////////////////
    struct IdentityClaimsV2 {
        bool isVerified; // 1 bit
        bool isSophisticatedInvestor; // 1 bit
        bool hasBankAccount; // 1 bit
        bool accountFrozen; // 1 bit
        bool requiresRegDAccreditation; // 1 bit
        bool hasValidRegDAccreditation; // 1 bit
        bool newProperty; // this is a new property to test the extension of the identity claims
    }

    function deserializeClaimsV2(bytes32 data) internal pure returns (IdentityClaimsV2 memory claims) {
        assembly {
            mstore(claims, and(data, 0x1))
            mstore(add(claims, 0x20), div(and(data, 0x2), 0x2))
            mstore(add(claims, 0x40), div(and(data, 0x4), 0x4))
            mstore(add(claims, 0x60), div(and(data, 0x8), 0x8))
            mstore(add(claims, 0x80), div(and(data, 0x10), 0x10))
            mstore(add(claims, 0xA0), div(and(data, 0x20), 0x20))
            mstore(add(claims, 0xC0), div(and(data, 0x40), 0x40))
        }
    }

    function getIdentityRecord(bytes32 claims) public pure returns (bool[7] deserializedClaims){
        IdentityClaimsV2 memory ds = deserializeClaimsV2(claims);
        assembly {
            deserializedClaims := ds
        }
    }
}

pragma solidity 0.4.15;


contract IdentityRecord {

    ////////////////////////
    // Types
    ////////////////////////

    /// @dev here the idea is to have claims of size of uint256 and use this struct
    ///     to translate in and out of this struct. until we do not cross uint256 we
    ///     have binary compatibility
    struct IdentityClaims {
        bool hasKyc; // 1 bit
        bool isSophisticatedInvestor; // 1 bit
        // uint254 reserved
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    /// translates uint256 to struct
    function deserializeClaims(uint256 data) internal constant returns (IdentityClaims memory claims) {
        // for memory layout of struct, each field below word length occupies whole word
        assembly {
            mstore(claims, and(data, 0x1))
            mstore(add(claims, 0x20), div(and(data, 0x2), 2))
        }
    }
}


contract IIdentityRegistry {
    /// get claims for identity
    function getClaims(address identity) public constant returns (uint256);
    /// set claims for identity
    /// @dev odlClaims and newClaims used for optimistic locking. to override with newClaims
    ///     current claims must be oldClaims
    function setClaims(address identity, uint256 oldClaims, uint256 newClaims) public;
}

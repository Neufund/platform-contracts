pragma solidity 0.4.24;


/// @title describes layout of claims in 256bit records stored for identities
/// @dev intended to be derived by contracts requiring access to particular claims
contract IdentityRecord {

    ////////////////////////
    // Types
    ////////////////////////

    /// @dev here the idea is to have claims of size of uint256 and use this struct
    ///     to translate in and out of this struct. until we do not cross uint256 we
    ///     have binary compatibility
    struct IdentityClaims {
        bool isVerified; // 1 bit
        bool isSophisticatedInvestor; // 1 bit
        bool hasBankAccount; // 1 bit
        bool accountFrozen; // 1 bit
        // uint252 reserved
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    /// translates uint256 to struct
    function deserializeClaims(bytes32 data) internal pure returns (IdentityClaims memory claims) {
        // for memory layout of struct, each field below word length occupies whole word
        assembly {
            mstore(claims, and(data, 0x1))
            mstore(add(claims, 0x20), div(and(data, 0x2), 0x2))
            mstore(add(claims, 0x40), div(and(data, 0x4), 0x4))
            mstore(add(claims, 0x60), div(and(data, 0x8), 0x8))
        }
    }
}


/// @title interface storing and retrieve 256bit claims records for identity
/// actual format of record is decoupled from storage (except maximum size)
contract IIdentityRegistry {

    ////////////////////////
    // Events
    ////////////////////////

    /// provides information on setting claims
    event LogSetClaims(
        address indexed identity,
        bytes32 oldClaims,
        bytes32 newClaims
    );

    ////////////////////////
    // Public functions
    ////////////////////////

    /// get claims for identity
    function getClaims(address identity) public constant returns (bytes32);

    /// set claims for identity
    /// @dev odlClaims and newClaims used for optimistic locking. to override with newClaims
    ///     current claims must be oldClaims
    function setClaims(address identity, bytes32 oldClaims, bytes32 newClaims) public;
}

pragma solidity 0.4.26;

import "../Standards/IContractId.sol";


/// @title sets duration of states in ETO
contract ETODurationTerms is IContractId {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // duration of Whitelist state
    uint32 public WHITELIST_DURATION;

    // duration of Public state
    uint32 public PUBLIC_DURATION;

    // time for Nominee and Company to sign Investment Agreement offchain and present proof on-chain
    uint32 public SIGNING_DURATION;

    // time for Claim before fee payout from ETO to NEU holders
    uint32 public CLAIM_DURATION;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        uint32 whitelistDuration,
        uint32 publicDuration,
        uint32 signingDuration,
        uint32 claimDuration
    )
        public
    {
        WHITELIST_DURATION = whitelistDuration;
        PUBLIC_DURATION = publicDuration;
        SIGNING_DURATION = signingDuration;
        CLAIM_DURATION = claimDuration;
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x5fb50201b453799d95f8a80291b940f1c543537b95bff2e3c78c2e36070494c0, 0);
    }
}

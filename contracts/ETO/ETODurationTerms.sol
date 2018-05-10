pragma solidity 0.4.23;


/// @title sets duration of states in ETO
contract ETODurationTerms {

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
}

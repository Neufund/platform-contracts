pragma solidity 0.4.24;


/// @title sets terms for tokens in ETO
contract ETOTokenTerms {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // minimum number of tokens being offered. will set min cap
    uint256 public MIN_NUMBER_OF_TOKENS;
    // maximum number of tokens being offered. will set max cap
    uint256 public MAX_NUMBER_OF_TOKENS;
    // base token price in EUR-T, without any discount scheme
    uint256 public TOKEN_PRICE_EUR_ULPS;
    // maximum number of tokens in whitelist phase
    uint256 public MAX_NUMBER_OF_TOKENS_IN_WHITELIST;


    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        uint256 minNumberOfTokens,
        uint256 maxNumberOfTokens,
        uint256 tokenPriceEurUlps
    )
        public
    {
        MIN_NUMBER_OF_TOKENS = minNumberOfTokens;
        MAX_NUMBER_OF_TOKENS = maxNumberOfTokens;
        TOKEN_PRICE_EUR_ULPS = tokenPriceEurUlps;
    }
}

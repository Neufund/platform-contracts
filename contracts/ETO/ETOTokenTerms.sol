pragma solidity 0.4.24;

import "../Standards/IContractId.sol";


/// @title sets terms for tokens in ETO
contract ETOTokenTerms is IContractId {

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
    // equity tokens per share
    uint256 public constant EQUITY_TOKENS_PER_SHARE = 10000;
    // equity tokens decimals (precision)
    uint8 public constant EQUITY_TOKENS_PRECISION = 0; // indivisible


    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        uint256 minNumberOfTokens,
        uint256 maxNumberOfTokens,
        uint256 tokenPriceEurUlps,
        uint256 maxNumberOfTokensInWhitelist
    )
        public
    {
        MIN_NUMBER_OF_TOKENS = minNumberOfTokens;
        MAX_NUMBER_OF_TOKENS = maxNumberOfTokens;
        TOKEN_PRICE_EUR_ULPS = tokenPriceEurUlps;
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST = maxNumberOfTokensInWhitelist;
        require(MAX_NUMBER_OF_TOKENS_IN_WHITELIST <= MAX_NUMBER_OF_TOKENS);
        require(MAX_NUMBER_OF_TOKENS >= MIN_NUMBER_OF_TOKENS);
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x591e791aab2b14c80194b729a2abcba3e8cce1918be4061be170e7223357ae5c, 0);
    }
}

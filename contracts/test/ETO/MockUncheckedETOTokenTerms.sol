pragma solidity 0.4.26;

import "../../ETO/ETOTokenTerms.sol";


/// @title does not check max tokens and max funds
contract MockUncheckedETOTokenTerms is ETOTokenTerms {


    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        string equityTokenName,
        string equityTokenSymbol,
        uint256 minNumberOfTokens,
        uint256 maxNumberOfTokens,
        uint256 tokenPriceEurUlps,
        uint256 maxNumberOfTokensInWhitelist,
        uint256 shareNominalValueUlps,
        uint256 shareNominalValueEurUlps,
        uint256 equityTokensPerShare
    )
        public
        // do not pass max, min ticket etc. to disable overflow checks
        ETOTokenTerms(
            equityTokenName,
            equityTokenSymbol,
            equityTokensPerShare,
            equityTokensPerShare,
            equityTokensPerShare,
            equityTokensPerShare,
            shareNominalValueUlps,
            shareNominalValueEurUlps,
            equityTokensPerShare
        )
    {
        require(maxNumberOfTokensInWhitelist <= maxNumberOfTokens, "NF_WL_TOKENS_GT_MAX_TOKENS");
        require(maxNumberOfTokens >= minNumberOfTokens, "NF_MIN_TOKENS_GT_MAX_TOKENS");
        // min cap must be > single share
        require(minNumberOfTokens >= equityTokensPerShare, "NF_ETO_TERMS_ONE_SHARE");

        MIN_NUMBER_OF_TOKENS = minNumberOfTokens;
        MAX_NUMBER_OF_TOKENS = maxNumberOfTokens;
        TOKEN_PRICE_EUR_ULPS = tokenPriceEurUlps;
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST = maxNumberOfTokensInWhitelist;
        EQUITY_TOKENS_PER_SHARE = equityTokensPerShare;
    }
}

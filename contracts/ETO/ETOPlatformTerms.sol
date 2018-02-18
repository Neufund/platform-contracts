pragma solidity 0.4.15;


/// @title set terms of Platform (investor's network) of the ETO
contract ETOPlatformTerms {

    ////////////////////////
    // Constants
    ////////////////////////

    // fraction of fee deduced on successful ETO (see Math.sol for fraction definition)
    uint256 public constant PLATFORM_FEE_FRACTION = 3 * 10**16;
    // fraction of tokens deduced on succesful ETO
    uint256 public constant TOKEN_PARTICIPATION_FEE_FRACTION = 2 * 10**16;
    // share of Neumark reward platform operator gets
    // actually this is a divisor that splits Neumark reward in two parts
    // the results of division belongs to platform operator, the remaining reward part belongs to investor
    uint256 public constant PLATFORM_NEUMARK_SHARE = 2; // 50:50 division
    // ICBM investors whitelisted by default
    bool public IS_ICBM_INVESTOR_WHITELISTED = true;

    // various constaints on ETOTerms by company

    // minimum ticket size Platform accepts in EUR ULPS
    uint256 public constant MIN_ACCEPTABLE_TICKET_EUR_ULPS = 500 * 10**18;
    // maximum ticket size Platform accepts in EUR ULPS
    uint256 public constant MAX_ACCEPTABLE_TICKET_EUR_ULPS = 10000000 * 10**18;

}

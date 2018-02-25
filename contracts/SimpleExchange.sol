pragma solidity 0.4.15;

import "./AccessControl/AccessControlled.sol";
import "./Standards/ITokenExchangeRateOracle.sol";
import "./AccessRoles.sol";
import "./EuroToken.sol";
import "./EtherToken.sol";
import "./Math.sol";


contract SimpleExchange is
    ITokenExchangeRateOracle,
    AccessControlled,
    AccessRoles,
    Math
{
    // ether token to store and transfer ether
    EtherToken private ETHER_TOKEN;
    // euro token to store and transfer euro
    EuroToken private EURO_TOKEN;

    address private PLATFORM_WALLET;

    function gasExchange(address wallet, uint256 amountEurUlps, uint256 exchangeFeeEurUlps)
        public
        only(ROLE_GAS_EXCHANGE)
    {
        // TODO: limit amount
        var (rate, rate_timestamp) = getExchangeRate(EURO_TOKEN, ETHER_TOKEN);
        // require if rate older than 4 hours
        require(block.timestamp - rate_timestamp < 6 hours);
        // exchange declated amount
        uint256 amountEthWei = decimalFraction(amountEurUlps, rate);
        // transfer out amount + fee
        EURO_TOKEN.transferFrom(wallet, PLATFORM_WALLET, amountEurUlps + exchangeFeeEurUlps);
        // transfer ether to wallet
        wallet.transfer(amountEthWei);
    }
}
